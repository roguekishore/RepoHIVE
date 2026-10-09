import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithDesign } from "../test-utils";
import { Button } from "./button";
import { Input } from "./field";
import { Modal } from "./modal";

function Harness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <Button>Elsewhere</Button>
      <Modal
        open={open}
        title="Index a repository"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        footer={
          <>
            <Button>Cancel</Button>
            <Button variant="primary">Check repository</Button>
          </>
        }
      >
        <Input aria-label="Repository" />
      </Modal>
    </>
  );
}

describe("Modal", () => {
  it("renders nothing while closed", () => {
    renderWithDesign(<Modal open={false} title="x" onClose={() => undefined}>body</Modal>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is a labelled modal dialog and focuses the first field", async () => {
    renderWithDesign(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog", { name: "Index a repository" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("Repository")).toHaveFocus();
  });

  it("closes on Escape and gives focus back to what opened it", async () => {
    const onClose = vi.fn();
    renderWithDesign(<Harness onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Open" });
    await userEvent.click(opener);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("closes from the close button and from a click on the scrim, but not from a click inside", async () => {
    const onClose = vi.fn();
    const { container } = renderWithDesign(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(container.querySelector(".rh-scrim") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps Tab inside the dialog, both ways", async () => {
    renderWithDesign(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    const field = screen.getByLabelText("Repository");
    const close = screen.getByRole("button", { name: "Close" });
    const primary = screen.getByRole("button", { name: "Check repository" });

    primary.focus();
    await userEvent.tab();
    expect(close).toHaveFocus();

    close.focus();
    await userEvent.tab({ shift: true });
    expect(primary).toHaveFocus();

    field.focus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });
});
