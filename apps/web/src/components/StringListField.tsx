import type { KeyboardEvent } from 'react';
import type {
  Control,
  FieldErrors,
  UseFormGetValues,
  UseFormSetValue,
  UseFormTrigger,
} from 'react-hook-form';
import { useWatch } from 'react-hook-form';
import { groupMessage, itemMessage } from '../form/schema';
import type { AvatarFormValues, ListName } from '../form/values';
import { Icon } from './Icon';

const MAX_ITEMS = 10;

type StringListFieldProps = {
  name: ListName;
  legend: string;
  hint?: string;
  addLabel: string;
  minItems?: number;
  /** The order matters, so each row shows its position and can be moved. */
  ordered?: boolean;
  control: Control<AvatarFormValues>;
  getValues: UseFormGetValues<AvatarFormValues>;
  setValue: UseFormSetValue<AvatarFormValues>;
  trigger: UseFormTrigger<AvatarFormValues>;
  errors: FieldErrors<AvatarFormValues>;
  serverErrors: Record<string, string>;
  clearServerError: (id: string) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  limitMessage?: string;
  onLimitMessage: (message: string | undefined) => void;
};

export function StringListField({
  name,
  legend,
  hint,
  addLabel,
  minItems = 0,
  ordered = false,
  control,
  getValues,
  setValue,
  trigger,
  errors,
  serverErrors,
  clearServerError,
  draft,
  onDraftChange,
  limitMessage,
  onLimitMessage,
}: StringListFieldProps) {
  const items = useWatch({ control, name }) ?? [];
  const groupError = serverErrors[name] ?? groupMessage(errors[name]);
  const atLimit = items.length >= MAX_ITEMS;
  const describedBy = [hint ? `${name}-hint` : '', groupError ? `${name}-error` : '']
    .filter(Boolean)
    .join(' ');

  function write(next: string[]) {
    setValue(name, next, { shouldDirty: true, shouldValidate: false });
    clearServerError(name);
  }

  function changeAt(index: number, value: string) {
    const next = [...getValues(name)];
    if (index < 0 || index >= next.length) return;
    next[index] = value;
    write(next);
    clearServerError(`${name}-${index}`);
  }

  function removeAt(index: number) {
    const current = getValues(name);
    write(current.filter((_, itemIndex) => itemIndex !== index));
    // Later rows move up one place, so a message tied to an old place no longer fits its row.
    for (let moved = index; moved < current.length; moved += 1) clearServerError(`${name}-${moved}`);
    void trigger(name);
  }

  /** Enter in a row goes to the next row, or to the add box, and never saves the form. */
  function onRowKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const isLast = index === items.length - 1;
    const next = document.getElementById(isLast ? `${name}-add` : `${name}-${index + 1}`);
    if (next instanceof HTMLInputElement && !next.disabled) next.focus();
  }

  function move(index: number, by: -1 | 1) {
    const next = [...getValues(name)];
    const target = index + by;
    const moved = next[index];
    const swapped = next[target];
    if (moved === undefined || swapped === undefined) return;
    next[index] = swapped;
    next[target] = moved;
    write(next);
    clearServerError(`${name}-${index}`);
    clearServerError(`${name}-${target}`);
    void trigger(name);
    // Keep the keyboard on the row that moved, on whichever control still works there.
    requestAnimationFrame(() => {
      const row = document.getElementById(`${name}-${target}`)?.closest('.list-row');
      const same = row?.querySelector<HTMLButtonElement>(`[data-move="${by}"]:not(:disabled)`);
      const other = row?.querySelector<HTMLButtonElement>(`[data-move="${-by}"]:not(:disabled)`);
      (same ?? other)?.focus();
    });
  }

  function addItem() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (items.length >= MAX_ITEMS) {
      onLimitMessage('Use at most 10.');
      return;
    }
    write([...getValues(name), trimmed]);
    onDraftChange('');
    onLimitMessage(undefined);
  }

  return (
    <fieldset
      id={name}
      tabIndex={-1}
      className="list-field"
      aria-describedby={describedBy || undefined}
      aria-invalid={groupError ? true : undefined}
    >
      <legend>
        <span>{legend}</span>
        {hint ? (
          <span id={`${name}-hint`} className="hint">
            {hint}
          </span>
        ) : null}
      </legend>
      {items.length > 0 ? (
        <ul className="string-list">
          {items.map((item, index) => {
            const inputId = `${name}-${index}`;
            const message = serverErrors[inputId] ?? itemMessage(errors[name], index);
            const removeDisabled = items.length <= minItems;
            return (
              <li key={inputId}>
                <div className="list-row">
                  {ordered ? (
                    <span className="list-index" aria-hidden="true">
                      {index + 1}
                    </span>
                  ) : null}
                  <input
                    id={inputId}
                    aria-label={`${legend} ${index + 1}`}
                    value={item}
                    aria-invalid={message ? true : undefined}
                    aria-describedby={message ? `${inputId}-error` : undefined}
                    onChange={(event) => changeAt(index, event.target.value)}
                    onKeyDown={(event) => onRowKeyDown(event, index)}
                    onBlur={() => {
                      void trigger(name);
                    }}
                  />
                  <div className="list-tools">
                    {ordered && items.length > 1 ? (
                      <>
                        <button
                          type="button"
                          className="icon-button"
                          data-move="-1"
                          onClick={() => move(index, -1)}
                          disabled={index === 0}
                        >
                          <Icon name="chevron-up" />
                          <span className="visually-hidden">Move {`${legend} ${index + 1}`} up</span>
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          data-move="1"
                          onClick={() => move(index, 1)}
                          disabled={index === items.length - 1}
                        >
                          <Icon name="chevron-down" />
                          <span className="visually-hidden">Move {`${legend} ${index + 1}`} down</span>
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="icon-button icon-button-danger"
                      onClick={() => removeAt(index)}
                      disabled={removeDisabled}
                      aria-describedby={removeDisabled ? `${inputId}-keep` : undefined}
                    >
                      <Icon name="x" />
                      <span className="visually-hidden">Remove {`${legend} ${index + 1}`}</span>
                    </button>
                  </div>
                </div>
                {removeDisabled ? (
                  <span id={`${inputId}-keep`} className="visually-hidden">
                    At least one is required.
                  </span>
                ) : null}
                {message ? (
                  <p id={`${inputId}-error`} className="field-error" role="alert">
                    {message}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {groupError ? (
        <p id={`${name}-error`} className="field-error" role="alert">
          {groupError}
        </p>
      ) : null}
      <div className="add-row">
        <label htmlFor={`${name}-add`}>
          {addLabel}
          {addLabel === 'Add' ? <span className="visually-hidden"> to {legend}</span> : null}
        </label>
        <div className="list-row">
          <input
            id={`${name}-add`}
            value={draft}
            disabled={atLimit}
            aria-invalid={limitMessage ? true : undefined}
            aria-describedby={limitMessage ? `${name}-limit` : undefined}
            onChange={(event) => {
              onDraftChange(event.target.value);
              onLimitMessage(undefined);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addItem();
              }
            }}
          />
          <button type="button" className="button button-quiet" onClick={addItem} disabled={atLimit || !draft.trim()}>
            <Icon name="plus" />
            Add<span className="visually-hidden"> to {legend}</span>
          </button>
        </div>
        {limitMessage ? (
          <p id={`${name}-limit`} className="field-error" role="alert">
            {limitMessage}
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
