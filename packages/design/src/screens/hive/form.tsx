"use client";

import { useId, useState, type FormEvent } from "react";
import { parseRepoInput } from "../dashboard/index-dialog";
import { useHive } from "./context";

type Note = { readonly text: string; readonly state: "err" | "ok" } | undefined;

/**
 * The one-line index form the page shows twice. It checks what was typed, then hands the repository to the page's
 * index-request dialog. `idle` is the line under it until something has been typed.
 */
export function HiveIndexForm({ idPrefix, idle }: { readonly idPrefix: string; readonly idle: string }) {
  const { requestIndex } = useHive();
  const id = useId();
  const inputId = `${idPrefix}-repo-${id}`;
  const noteId = `${idPrefix}-note-${id}`;
  const [value, setValue] = useState("");
  const [note, setNote] = useState<Note>();

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
    requestIndex(repo);
  };

  return (
    <>
      <form className="hv-ix" onSubmit={submit} noValidate>
        <label className="hv-field" htmlFor={inputId} data-invalid={note?.state === "err" ? "" : undefined}>
          <span>github.com/</span>
          <input
            id={inputId}
            autoComplete="off"
            spellCheck={false}
            placeholder="apache/kafka"
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
        <button className="hv-btn hv-primary" type="submit">
          Index it
        </button>
      </form>
      <p id={noteId} className="hv-note" data-state={note?.state} aria-live="polite">
        {note?.text ?? idle}
      </p>
    </>
  );
}
