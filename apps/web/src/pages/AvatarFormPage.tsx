import type { Avatar, AvatarCreate, AvatarUpdate } from '@avatars/contracts/avatar';
import { zAvatarCreate, zAvatarId, zAvatarUpdate } from '@avatars/contracts/avatar/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useForm, useWatch, type FieldErrors, type Resolver } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import {
  createAvatarRequest,
  deleteAvatarRequest,
  fetchAvatar,
  updateAvatarRequest,
} from '../api/avatars';
import { ProblemError } from '../api/problem';
import { AvatarOrb } from '../components/AvatarOrb';
import { Field } from '../components/Field';
import { Icon } from '../components/Icon';
import { IntensityMeter } from '../components/IntensityMeter';
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
  type ListErrors,
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

// Each line says what the assistant's prompt does at that level.
const INTENSITIES = [
  ['subtle', 'Subtle', 'Its priorities decide what the answer covers. The voice stays plain.'],
  ['balanced', 'Balanced', 'Its priorities, and its way of speaking.'],
  ['immersive', 'Immersive', 'Fully in character, in the first person.'],
] as const;

const DUPLICATE_MESSAGE = 'Already in this list.';

// The generated Zod schemas do not carry uniqueItems, so the browser checks it here.
function withDuplicateCheck(resolver: Resolver<AvatarFormValues>): Resolver<AvatarFormValues> {
  return async (values, context, options) => {
    const result = await resolver(values, context, options);
    const duplicates = duplicateItems(normalizeForm(values));
    if (duplicates.length === 0) return result;
    const errors: Record<string, unknown> = { ...result.errors };
    for (const { field, index } of duplicates) {
      const existing = errors[field] as ListErrors | undefined;
      const list: ListErrors = existing ? [...existing] : [];
      // Copying an array keeps its rows only, so the message about the whole list is put back.
      if (existing?.root) list.root = existing.root;
      list[index] ??= { type: 'unique', message: DUPLICATE_MESSAGE };
      errors[field] = list;
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
      <div className="narrow">
        <BackLink />
        <div className="empty">
          <h1>Avatar not found</h1>
          <p className="lede" role="alert">
            There is no avatar at this address. It may have been deleted.
          </p>
          <div className="empty-actions">
            <Link className="button button-quiet" to="/avatars">
              Back to avatars
            </Link>
          </div>
        </div>
      </div>
    );
  }
  if (query.isPending) {
    return (
      <div className="narrow">
        <BackLink />
        <h1>Edit avatar</h1>
        <p className="status" role="status">
          Loading avatar.
        </p>
      </div>
    );
  }
  if (query.isError || !query.data) {
    const message = query.error instanceof ProblemError ? query.error.detail : 'This avatar could not be loaded.';
    return (
      <div className="narrow">
        <BackLink />
        <h1>Edit avatar</h1>
        <div className="notice notice-error">
          <p role="alert">{message}</p>
          <button type="button" className="button button-quiet" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return <AvatarEditor key={query.data.id} mode="edit" avatar={query.data} />;
}

function AvatarEditor({ mode, avatar }: { mode: 'create' | 'edit'; avatar?: Avatar }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const alive = useRef(true);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
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
    if (!dialog || dialog.open) return;
    dialog.showModal();
    // The keyboard starts on Cancel, never on Delete.
    cancelRef.current?.focus();
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
  const liveName = useWatch({ control: form.control, name: 'name' }) ?? '';
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
    <div className="narrow">
      <BackLink />
      <div className="editor-head">
        <AvatarOrb name={liveName.trim() || '?'} size="xl" />
        <div className="editor-title">
          <p className="eyebrow">{mode === 'create' ? 'New avatar' : 'Edit avatar'}</p>
          <h1>{liveName.trim() || 'Untitled avatar'}</h1>
          {mode === 'edit' && avatar ? (
            <p>
              {avatar.createdBy === 'assistant' ? 'Created by the assistant' : 'Created in the library'} ·{' '}
              {formatCreatedOn(avatar.createdAt)}
            </p>
          ) : (
            <p>Describe a stance. The assistant uses it to pick this avatar and to answer as it.</p>
          )}
        </div>
        {mode === 'edit' && avatar ? (
          <div className="editor-actions">
            <Link className="button button-quiet" to={`/chat?avatar=${avatar.id}`}>
              <Icon name="message" />
              Ask in chat
            </Link>
            <button type="button" className="button button-danger" onClick={openDelete}>
              <Icon name="trash" />
              Delete
            </button>
          </div>
        ) : null}
      </div>
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
        <div className="notice notice-error">
          <p role="alert">{formError}</p>
        </div>
      ) : null}
      <form className="avatar-form" noValidate onSubmit={onSubmit} aria-busy={saving}>
        <section className="panel">
          <div className="panel-head">
            <h2>Identity</h2>
            <p>Who this avatar is.</p>
          </div>
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
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>When to use it</h2>
            <p>The assistant reads these to decide whether this avatar fits a question.</p>
          </div>
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
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Stance</h2>
            <p>How it sees a question, and how it speaks.</p>
          </div>
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
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Priorities</h2>
            <p>What decides the answer, and what is left out of it.</p>
          </div>
          <StringListField
            {...listProps}
            name="caresAbout"
            legend="Cares about"
            hint="Most important first"
            addLabel="Add"
            minItems={1}
            ordered
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
        </section>
        <section className="panel">
          <fieldset
            id="intensity"
            tabIndex={-1}
            className="intensity"
            aria-invalid={intensityError ? true : undefined}
            aria-describedby={intensityError ? 'intensity-error' : 'intensity-hint'}
          >
            <legend>Intensity</legend>
            <p id="intensity-hint" className="hint">
              How strongly the avatar shapes an answer.
            </p>
            <div className="choices">
              {INTENSITIES.map(([value, label, text]) => (
                <label key={value} className="choice" htmlFor={`intensity-${value}`}>
                  <input
                    id={`intensity-${value}`}
                    type="radio"
                    {...register('intensity', { onChange: () => clearServerError('intensity') })}
                    value={value}
                  />
                  <span className="choice-title">
                    {label}
                    <IntensityMeter intensity={value} />
                  </span>
                  <span className="choice-text">{text}</span>
                </label>
              ))}
            </div>
            {intensityError ? (
              <p id="intensity-error" className="field-error" role="alert">
                {intensityError}
              </p>
            ) : null}
          </fieldset>
        </section>
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
          <p id="delete-title" className="dialog-title">
            Delete {avatar.name}?
          </p>
          <p className="dialog-text">It is removed from the library and cannot be restored.</p>
          {deleteError ? (
            <p className="field-error" role="alert">
              {deleteError}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button ref={cancelRef} type="button" className="button button-quiet" onClick={closeDelete}>
              Cancel
            </button>
            <button type="button" className="button button-danger" onClick={() => void confirmDelete()} disabled={deleting}>
              {deleting ? 'Deleting' : 'Delete'}
            </button>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
