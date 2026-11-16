import type { Avatar, AvatarCreate, AvatarUpdate } from '@avatars/contracts/avatar';
import { zAvatarCreate, zAvatarId, zAvatarUpdate } from '@avatars/contracts/avatar/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import {
  createAvatarRequest,
  deleteAvatarRequest,
  fetchAvatar,
  updateAvatarRequest,
} from '../api/avatars';
import { ProblemError } from '../api/problem';
import { Field } from '../components/Field';
import { BackLink } from '../components/Shell';
import { StringListField } from '../components/StringListField';
import { formatCreatedOn } from '../format';
import {
  FIELD_LABELS,
  avatarFormResolver,
  labelForPointer,
  pointerToId,
  readableValidationMessage,
  summarizeErrors,
  type SummaryItem,
} from '../form/schema';
import {
  applyDrafts,
  avatarToForm,
  duplicateItems,
  emptyAvatarForm,
  emptyDrafts,
  normalizeForm,
  type AvatarFormValues,
  type Drafts,
  type ListName,
} from '../form/values';
import { useDocumentTitle } from '../useDocumentTitle';

const INTENSITIES = [
  ['subtle', 'Subtle'],
  ['balanced', 'Balanced'],
  ['immersive', 'Immersive'],
] as const;

const DUPLICATE_MESSAGE = 'Already in this list.';

// The generated Zod schemas do not carry uniqueItems, so the browser checks it here.
function withDuplicateCheck(resolver: Resolver<AvatarFormValues>): Resolver<AvatarFormValues> {
  return async (values, context, options) => {
    const result = await resolver(values, context, options);
    const duplicates = duplicateItems(normalizeForm(values));
    if (duplicates.length === 0) return result;
    const errors: Record<string, Record<string, unknown>> = { ...(result.errors as Record<string, Record<string, unknown>>) };
    for (const { field, index } of duplicates) {
      const existing = { ...errors[field] };
      existing[String(index)] ??= { type: 'unique', message: DUPLICATE_MESSAGE };
      errors[field] = existing;
    }
    return { values: {}, errors: errors as FieldErrors<AvatarFormValues> };
  };
}

function serverFieldMessage(message: string): string {
  if (message === 'items must be unique') return DUPLICATE_MESSAGE;
  if (message === 'must contain at least 1 item') return 'Add at least one.';
  const atMost = message.match(/^must contain at most (\d+) items$/);
  if (atMost) return `Use at most ${atMost[1]}.`;
  return readableValidationMessage(message);
}

export function AvatarFormPage() {
  const { avatarId } = useParams();
  const isEdit = Boolean(avatarId);
  const validId = zAvatarId.safeParse(avatarId).success;
  const query = useQuery({
    queryKey: ['avatar', avatarId],
    queryFn: () => fetchAvatar(avatarId ?? ''),
    enabled: isEdit && validId,
  });
  const status = query.error instanceof ProblemError ? query.error.status : 0;
  const notFound = isEdit && (!validId || status === 404 || status === 400);

  useDocumentTitle(notFound ? 'Avatar not found' : isEdit ? 'Edit avatar' : 'New avatar');

  if (!isEdit) return <AvatarEditor mode="create" />;
  if (notFound) {
    return (
      <>
        <BackLink />
        <h1>Avatar not found</h1>
        <p role="alert">There is no avatar at this address. It may have been deleted.</p>
        <p>
          <Link to="/avatars">Back to avatars</Link>
        </p>
      </>
    );
  }
  if (query.isPending) {
    return (
      <>
        <BackLink />
        <h1>Edit avatar</h1>
        <p role="status">Loading avatar.</p>
      </>
    );
  }
  if (query.isError || !query.data) {
    const message = query.error instanceof ProblemError ? query.error.detail : 'This avatar could not be loaded.';
    return (
      <>
        <BackLink />
        <h1>Edit avatar</h1>
        <div className="notice">
          <p role="alert">{message}</p>
          <button type="button" className="button button-quiet" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      </>
    );
  }

  return <AvatarEditor key={query.data.id} mode="edit" avatar={query.data} />;
}

function AvatarEditor({ mode, avatar }: { mode: 'create' | 'edit'; avatar?: Avatar }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const alive = useRef(true);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<SummaryItem[]>([]);
  const [focusToken, setFocusToken] = useState(0);
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [drafts, setDrafts] = useState<Drafts>(emptyDrafts);
  const [limits, setLimits] = useState<Partial<Record<ListName, string>>>({});

  const form = useForm<AvatarFormValues>({
    defaultValues: avatar ? avatarToForm(avatar) : emptyAvatarForm(),
    resolver: withDuplicateCheck(avatarFormResolver(mode)),
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    shouldFocusError: false,
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const items = pendingFocus.current;
    if (items.length === 0) return;
    if (items.length > 1) summaryRef.current?.focus();
    else document.getElementById(items[0]?.id ?? '')?.focus();
  }, [focusToken]);

  function queueFocus(items: SummaryItem[]) {
    pendingFocus.current = items;
    setSummary(items.length > 1 ? items : []);
    setFocusToken((token) => token + 1);
  }

  function clearServerError(id: string) {
    setServerErrors((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function setDraft(name: ListName, value: string) {
    setDrafts((current) => ({ ...current, [name]: value }));
  }

  function setLimit(name: ListName, message: string | undefined) {
    setLimits((current) => ({ ...current, [name]: message }));
  }

  function flushDrafts(): boolean {
    const limited = new Set<ListName>();
    const next = normalizeForm(
      applyDrafts(form.getValues(), drafts, (field) => {
        limited.add(field);
      }),
    );
    form.setValue('name', next.name);
    form.setValue('description', next.description);
    form.setValue('perspective', next.perspective);
    form.setValue('voice', next.voice);
    form.setValue('useWhen', next.useWhen);
    form.setValue('caresAbout', next.caresAbout);
    form.setValue('ignores', next.ignores);
    form.setValue('intensity', next.intensity);
    setDrafts({
      useWhen: limited.has('useWhen') ? drafts.useWhen : '',
      caresAbout: limited.has('caresAbout') ? drafts.caresAbout : '',
      ignores: limited.has('ignores') ? drafts.ignores : '',
    });
    setLimits({
      useWhen: limited.has('useWhen') ? 'Use at most 10.' : undefined,
      caresAbout: limited.has('caresAbout') ? 'Use at most 10.' : undefined,
      ignores: limited.has('ignores') ? 'Use at most 10.' : undefined,
    });
    return limited.size === 0;
  }

  function onInvalid(errors: FieldErrors<AvatarFormValues>) {
    queueFocus(summarizeErrors(errors));
  }

  async function onValid(values: AvatarFormValues) {
    setSaving(true);
    setFormError(undefined);
    setServerErrors({});
    const normalized = normalizeForm(values);
    const parsed = (mode === 'create' ? zAvatarCreate : zAvatarUpdate).safeParse(normalized);
    if (!parsed.success) {
      const items = parsed.error.issues.flatMap((issue) => {
        const head = issue.path[0];
        if (typeof head !== 'string') return [];
        const id = issue.path.length > 1 ? `${head}-${String(issue.path[1])}` : head;
        const label = head in FIELD_LABELS ? FIELD_LABELS[head as keyof typeof FIELD_LABELS] : 'Field';
        return [{ id, label, message: readableValidationMessage(issue.message) }];
      });
      queueFocus(items);
      setSaving(false);
      return;
    }

    try {
      let saved: Avatar | undefined;
      if (mode === 'create') {
        const body: AvatarCreate = {
          name: normalized.name,
          description: normalized.description,
          perspective: normalized.perspective,
          voice: normalized.voice,
          caresAbout: normalized.caresAbout,
          ignores: normalized.ignores,
          useWhen: normalized.useWhen,
          intensity: normalized.intensity,
          createdBy: 'user',
        };
        saved = await createAvatarRequest(body);
      } else if (avatar) {
        const body: AvatarUpdate = {
          name: normalized.name,
          description: normalized.description,
          perspective: normalized.perspective,
          voice: normalized.voice,
          caresAbout: normalized.caresAbout,
          ignores: normalized.ignores,
          useWhen: normalized.useWhen,
          intensity: normalized.intensity,
        };
        saved = await updateAvatarRequest(avatar.id, body);
      }
      if (saved) queryClient.setQueryData(['avatar', saved.id], saved);
      await queryClient.invalidateQueries({ queryKey: ['avatars'], refetchType: 'all' });
      if (alive.current) navigate('/avatars');
    } catch (error) {
      if (!alive.current) return;
      applyProblem(error instanceof ProblemError ? error : new ProblemError(undefined, 'The avatar could not be saved.'));
    } finally {
      if (alive.current) setSaving(false);
    }
  }

  function applyProblem(problem: ProblemError) {
    if (problem.status === 409) {
      const message = 'That name is already used.';
      setServerErrors({ name: message });
      queueFocus([{ id: 'name', label: 'Name', message }]);
      return;
    }

    if (problem.fieldErrors.length > 0) {
      const map: Record<string, string> = {};
      const items: SummaryItem[] = [];
      const unmatched: string[] = [];
      for (const fieldError of problem.fieldErrors) {
        const id = pointerToId(fieldError.field);
        const label = labelForPointer(fieldError.field);
        const message = serverFieldMessage(fieldError.message);
        if (!id || !label) {
          unmatched.push(message);
          continue;
        }
        map[id] = map[id] ? `${map[id]} ${message}` : message;
        items.push({ id, label, message });
      }
      setServerErrors(map);
      if (unmatched.length > 0) setFormError(unmatched.join(' '));
      if (items.length > 0) queueFocus(items);
      return;
    }

    setFormError(problem.detail || 'The avatar could not be saved.');
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerErrors({});
    setFormError(undefined);
    if (!flushDrafts()) return;
    void form.handleSubmit(onValid, onInvalid)(event);
  }

  function openDelete() {
    setDeleteError(undefined);
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }

  function closeDelete() {
    dialogRef.current?.close();
  }

  async function confirmDelete() {
    if (!avatar) return;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await deleteAvatarRequest(avatar.id);
      queryClient.setQueryData<Avatar[]>(['avatars'], (items) => items?.filter((item) => item.id !== avatar.id));
      await queryClient.invalidateQueries({ queryKey: ['avatars'], refetchType: 'all' });
      closeDelete();
      if (alive.current) navigate('/avatars');
    } catch (error) {
      if (!alive.current) return;
      const problem = error instanceof ProblemError ? error : new ProblemError(undefined, 'The avatar could not be deleted.');
      setDeleteError(problem.detail);
    } finally {
      if (alive.current) setDeleting(false);
    }
  }

  const {
    register,
    formState: { errors },
  } = form;
  const nameError = errors.name?.message ?? serverErrors.name;
  const descriptionError = errors.description?.message ?? serverErrors.description;
  const perspectiveError = errors.perspective?.message ?? serverErrors.perspective;
  const voiceError = errors.voice?.message ?? serverErrors.voice;
  const intensityError = errors.intensity?.message ?? serverErrors.intensity;

  const listProps = {
    control: form.control,
    getValues: form.getValues,
    setValue: form.setValue,
    trigger: form.trigger,
    errors,
    serverErrors,
    clearServerError,
  };

  return (
    <>
      <BackLink />
      <h1>{mode === 'create' ? 'New avatar' : 'Edit avatar'}</h1>
      {mode === 'edit' && avatar ? (
        <div className="meta-row">
          <p>
            Created by {avatar.createdBy} · {formatCreatedOn(avatar.createdAt)}
          </p>
          <button type="button" className="button button-danger" onClick={openDelete}>
            Delete
          </button>
        </div>
      ) : null}
      {summary.length > 1 ? (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="error-summary">
          <p>Some fields need a change before this can be saved.</p>
          <ul>
            {summary.map((item) => (
              <li key={`${item.id}-${item.message}`}>
                <a
                  href={`#${item.id}`}
                  onClick={(event) => {
                    const target = document.getElementById(item.id);
                    if (!target) return;
                    event.preventDefault();
                    target.focus();
                  }}
                >
                  {item.label}: {item.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {formError ? (
        <p className="field-error" role="alert">
          {formError}
        </p>
      ) : null}
      <form className="avatar-form" noValidate onSubmit={onSubmit} aria-busy={saving}>
        <Field id="name" label="Name" required error={nameError}>
          {(props) => (
            <input
              {...register('name', { onChange: () => clearServerError('name') })}
              {...props}
              type="text"
              autoComplete="off"
            />
          )}
        </Field>
        <Field
          id="description"
          label="Description"
          required
          hint="One or two sentences on who this is."
          error={descriptionError}
        >
          {(props) => (
            <textarea
              {...register('description', { onChange: () => clearServerError('description') })}
              {...props}
              rows={3}
            />
          )}
        </Field>
        <StringListField
          {...listProps}
          name="useWhen"
          legend="Use when"
          hint="Optional"
          addLabel="Add a situation"
          draft={drafts.useWhen}
          onDraftChange={(value) => setDraft('useWhen', value)}
          limitMessage={limits.useWhen}
          onLimitMessage={(message) => setLimit('useWhen', message)}
        />
        <Field id="perspective" label="Perspective" required hint="What it looks at first." error={perspectiveError}>
          {(props) => (
            <textarea
              {...register('perspective', { onChange: () => clearServerError('perspective') })}
              {...props}
              rows={4}
            />
          )}
        </Field>
        <Field id="voice" label="Voice" required hint="How it speaks." error={voiceError}>
          {(props) => (
            <textarea {...register('voice', { onChange: () => clearServerError('voice') })} {...props} rows={3} />
          )}
        </Field>
        <StringListField
          {...listProps}
          name="caresAbout"
          legend="Cares about"
          hint="most first"
          addLabel="Add"
          minItems={1}
          draft={drafts.caresAbout}
          onDraftChange={(value) => setDraft('caresAbout', value)}
          limitMessage={limits.caresAbout}
          onLimitMessage={(message) => setLimit('caresAbout', message)}
        />
        <StringListField
          {...listProps}
          name="ignores"
          legend="Ignores"
          hint="Optional"
          addLabel="Add"
          draft={drafts.ignores}
          onDraftChange={(value) => setDraft('ignores', value)}
          limitMessage={limits.ignores}
          onLimitMessage={(message) => setLimit('ignores', message)}
        />
        <fieldset
          id="intensity"
          tabIndex={-1}
          className="intensity"
          aria-invalid={intensityError ? true : undefined}
          aria-describedby={intensityError ? 'intensity-error' : 'intensity-hint'}
        >
          <legend>Intensity</legend>
          <p id="intensity-hint" className="hint">
            Subtle covers priorities only. Balanced adds voice. Immersive answers in character.
          </p>
          <div className="radios">
            {INTENSITIES.map(([value, label]) => (
              <label key={value} htmlFor={`intensity-${value}`}>
                <input
                  id={`intensity-${value}`}
                  type="radio"
                  {...register('intensity', { onChange: () => clearServerError('intensity') })}
                  value={value}
                />
                {label}
              </label>
            ))}
          </div>
          {intensityError ? (
            <p id="intensity-error" className="field-error" role="alert">
              {intensityError}
            </p>
          ) : null}
        </fieldset>
        <div className="form-actions">
          <Link className="button button-quiet" to="/avatars">
            Cancel
          </Link>
          <button type="submit" className="button button-primary" disabled={saving}>
            {saving ? 'Saving' : 'Save'}
          </button>
        </div>
      </form>
      {mode === 'edit' && avatar ? (
        <dialog ref={dialogRef} aria-labelledby="delete-title" onClose={() => setDeleting(false)}>
          <p id="delete-title">Delete {avatar.name}?</p>
          {deleteError ? (
            <p className="field-error" role="alert">
              {deleteError}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="button" className="button button-danger" onClick={() => void confirmDelete()} disabled={deleting}>
              {deleting ? 'Deleting' : 'Delete'}
            </button>
            <button type="button" className="button button-quiet" onClick={closeDelete} autoFocus>
              Cancel
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
