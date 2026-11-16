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

const MAX_ITEMS = 10;

type StringListFieldProps = {
  name: ListName;
  legend: string;
  hint?: string;
  addLabel: string;
  minItems?: number;
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
    write(getValues(name).filter((_, itemIndex) => itemIndex !== index));
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
                  <input
                    id={inputId}
                    aria-label={`${legend} ${index + 1}`}
                    value={item}
                    aria-invalid={message ? true : undefined}
                    aria-describedby={message ? `${inputId}-error` : undefined}
                    onChange={(event) => changeAt(index, event.target.value)}
                    onBlur={() => {
                      void trigger(name);
                    }}
                  />
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={() => removeAt(index)}
                    disabled={removeDisabled}
                    aria-describedby={removeDisabled ? `${inputId}-keep` : undefined}
                  >
                    Remove<span className="visually-hidden"> {`${legend} ${index + 1}`}</span>
                  </button>
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
