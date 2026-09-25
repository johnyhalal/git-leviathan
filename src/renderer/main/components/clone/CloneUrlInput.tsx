interface CloneUrlInputProps {
  value: string;
  onChange: (url: string) => void;
}

/** The middle input for the "Clone with URL" source: a repository URL field. */
export function CloneUrlInput({ value, onChange }: CloneUrlInputProps) {
  return (
    <div className="form-field">
      <label className="form-label" htmlFor="clone-url">
        Repository URL
      </label>
      <input
        id="clone-url"
        type="text"
        className="form-input form-input-lg"
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
