import { useEffect, useRef, useState } from 'react';

export default function InlineInput({
  value,
  onCommit,
  required = false,
  ...props
}) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);

  return (
    <input
      {...props}
      value={draft}
      title="Press Enter or leave this field to save"
      onFocus={() => {
        editing.current = true;
        cancelled.current = false;
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        editing.current = false;
        if (cancelled.current || (required && !draft.trim())) {
          setDraft(value);
          return;
        }
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === 'Escape') {
          cancelled.current = true;
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
