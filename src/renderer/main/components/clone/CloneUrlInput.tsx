interface CloneUrlInputProps {
  value: string;
  onChange: (url: string) => void;
}

/** The middle input for the "Clone with URL" source: a repository URL field. */
export function CloneUrlInput({ value, onChange }: CloneUrlInputProps) {
  return (
    <div className="clone-field">
      <label className="clone-label" htmlFor="clone-url">
        Repository URL
      </label>
      <input
        id="clone-url"
        type="text"
        className="clone-input"
        placeholder="https://github.com/user/repo.git"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoFocus
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}
