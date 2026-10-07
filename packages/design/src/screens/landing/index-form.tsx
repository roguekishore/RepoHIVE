"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "../../components/button";
import { Icon } from "../../icons/icons";
import { IndexRequestDialog, parseRepoInput } from "../dashboard/index-dialog";

type Note = { readonly text: string; readonly state: "err" | "ok" } | undefined;

/**
 * The one-line index form the page shows twice. It checks what was typed and then opens the real request dialog.
 * `arrow` adds the arrow that nudges on hover (the closing form has it).
 */
export function IndexForm({ idPrefix, arrow = false }: { readonly idPrefix: string; readonly arrow?: boolean }) {
  const id = useId();
  const inputId = `${idPrefix}-repo-${id}`;
  const noteId = `${idPrefix}-note-${id}`;
  const [value, setValue] = useState("");
  const [note, setNote] = useState<Note>();
  const [dialogRepo, setDialogRepo] = useState<string | undefined>();

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (value.trim() === "") {
      setNote({ text: "Enter a repository, for example apache/kafka.", state: "err" });
      return;
    }
    const repo = parseRepoInput(value);
    if (repo === undefined) {
      setNote({ text: "Use owner/repo or a github.com link, for example apache/kafka.", state: "err" });
      return;
    }
    setNote({ text: `${repo} looks right.`, state: "ok" });
    setDialogRepo(repo);
  };

  return (
    <div className="rh-ld-cta">
      <form className="rh-ld-form" onSubmit={submit} noValidate>
        <label className="rh-ld-field" htmlFor={inputId} data-invalid={note?.state === "err" ? "" : undefined}>
          <Icon name="repo" size={16} />
          <input
            id={inputId}
            placeholder="owner/repo or GitHub link"
            autoComplete="off"
            aria-label="Repository"
            aria-describedby={noteId}
            aria-invalid={note?.state === "err" ? true : undefined}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              // Typing after an error clears it.
              if (note?.state === "err") setNote(undefined);
            }}
          />
        </label>
        <Button type="submit" variant="primary" size="lg">
          Index it
          {arrow ? <Icon name="arrow" size={16} className="rh-ld-arrow" /> : null}
        </Button>
      </form>
      <p id={noteId} className="rh-ld-note" data-state={note?.state} aria-live="polite">
        {note?.text}
      </p>
      <IndexRequestDialog open={dialogRepo !== undefined} initialRepo={dialogRepo} onClose={() => setDialogRepo(undefined)} />
    </div>
  );
}
