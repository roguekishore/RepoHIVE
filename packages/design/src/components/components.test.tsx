import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithDesign } from "../test-utils";
import { Button, LinkButton } from "./button";
import { Chip, SegmentedControl, Select } from "./controls";
import { Field, Input, LabeledInput } from "./field";
import { Alert, EmptyState, Page, Text } from "./feedback";
import { KeyValueList, Panel } from "./panel";
import { DecisionGlyph, DecisionTag, Meter, SplitBar, StatusDot, StatusTag } from "./status";
import { Table, type TableColumn } from "./table";

describe("Button", () => {
  it("is a button that does not submit forms unless asked", async () => {
    const onClick = vi.fn();
    renderWithDesign(<Button onClick={onClick}>Index</Button>);
    const button = screen.getByRole("button", { name: "Index" });
    expect(button).toHaveAttribute("type", "button");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("carries variant, size and icon classes", () => {
    renderWithDesign(
      <Button variant="primary" size="sm" icon aria-label="Add">
        +
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Add" })).toHaveClass("rh-btn", "rh-btn-primary", "rh-btn-sm", "rh-btn-icon");
  });

  it("does not fire when disabled", async () => {
    const onClick = vi.fn();
    renderWithDesign(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("LinkButton goes through the host's link component", () => {
    renderWithDesign(<LinkButton href="/repos">Repositories</LinkButton>);
    const link = screen.getByRole("link", { name: "Repositories" });
    expect(link).toHaveAttribute("href", "/repos");
    expect(link).toHaveAttribute("data-host-link", "true");
    expect(link).toHaveClass("rh-btn");
  });
});

describe("Field and inputs", () => {
  it("Field is one focus target with an icon and a key hint", async () => {
    renderWithDesign(<Field icon="search" hint="/" placeholder="Filter" aria-label="Filter" />);
    const input = screen.getByRole("textbox", { name: "Filter" });
    await userEvent.type(input, "abc");
    expect(input).toHaveValue("abc");
    expect(screen.getByText("/")).toBeInTheDocument();
  });

  it("Input marks itself invalid", () => {
    renderWithDesign(<Input aria-label="Email" invalid />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("LabeledInput ties the label and the note to the input", () => {
    renderWithDesign(<LabeledInput label="Repository" hint="owner/repo" />);
    const input = screen.getByLabelText("Repository");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveAccessibleDescription("owner/repo");
  });

  it("LabeledInput shows an error in place of the hint and marks the input invalid", () => {
    renderWithDesign(<LabeledInput label="Repository" hint="owner/repo" error="Use owner/repo." />);
    const input = screen.getByLabelText("Repository");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Use owner/repo.");
    expect(screen.getByText("Use owner/repo.")).toHaveClass("rh-form-error");
  });
});

describe("Chip, Select, SegmentedControl", () => {
  it("Chip reports pressed state", async () => {
    const onClick = vi.fn();
    renderWithDesign(
      <Chip pressed onClick={onClick}>
        XL
      </Chip>,
    );
    const chip = screen.getByRole("button", { name: "XL" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(chip);
    expect(onClick).toHaveBeenCalled();
  });

  it("Select is a native select with a required label", async () => {
    const onChange = vi.fn();
    renderWithDesign(
      <Select aria-label="Sort" onChange={(event) => onChange(event.target.value)} defaultValue="recent">
        <option value="recent">Recently indexed</option>
        <option value="name">Name</option>
      </Select>,
    );
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "name");
    expect(onChange).toHaveBeenCalledWith("name");
  });

  it("SegmentedControl marks the chosen one and reports a change", async () => {
    const onChange = vi.fn();
    renderWithDesign(
      <SegmentedControl
        label="Theme"
        value="dark"
        onChange={onChange}
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
          { value: "system", label: "Auto" },
        ]}
      />,
    );
    const group = screen.getByRole("group", { name: "Theme" });
    expect(within(group).getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(within(group).getByRole("button", { name: "Auto" }));
    expect(onChange).toHaveBeenCalledWith("system");
  });
});

describe("Panel and KeyValueList", () => {
  it("Panel shows a titled header and its content", () => {
    renderWithDesign(
      <Panel title="Snapshot" actions={<button type="button">Copy</button>}>
        <p>body</p>
      </Panel>,
    );
    expect(screen.getByRole("heading", { name: "Snapshot" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("Panel without a title has no header", () => {
    renderWithDesign(<Panel>content</Panel>);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("KeyValueList is a definition list in order", () => {
    renderWithDesign(
      <KeyValueList
        items={[
          { label: "Commit", value: "abc123" },
          { label: "Nodes", value: "29,190" },
        ]}
      />,
    );
    const terms = screen.getAllByRole("term").map((node) => node.textContent);
    const values = screen.getAllByRole("definition").map((node) => node.textContent);
    expect(terms).toEqual(["Commit", "Nodes"]);
    expect(values).toEqual(["abc123", "29,190"]);
  });
});

interface Row {
  readonly id: string;
  readonly name: string;
  readonly files: number;
}

const ROWS: readonly Row[] = [
  { id: "a", name: "core.order", files: 120 },
  { id: "b", name: "core.catalog", files: 80 },
];

const COLUMNS: readonly TableColumn<Row>[] = [
  { key: "name", header: "Region", render: (row) => row.name, sortable: true },
  { key: "files", header: "Files", render: (row) => row.files, numeric: true, sortable: true },
];

describe("Table", () => {
  it("renders headers and rows, with a caption for assistive technology", () => {
    renderWithDesign(<Table caption="Regions" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} />);
    expect(screen.getByRole("table", { name: "Regions" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((node) => node.textContent)).toEqual(["Region", "Files"]);
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("marks the sorted column and tells the host which header was pressed", async () => {
    const onSort = vi.fn();
    renderWithDesign(
      <Table
        caption="Regions"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        sort={{ key: "files", direction: "descending" }}
        onSort={onSort}
      />,
    );
    expect(screen.getByRole("columnheader", { name: /Files/ })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("columnheader", { name: /Region/ })).toHaveAttribute("aria-sort", "none");
    await userEvent.click(screen.getByRole("button", { name: /Region/ }));
    expect(onSort).toHaveBeenCalledWith("name");
  });

  it("makes rows activatable by click and by keyboard, and shows the selected one", async () => {
    const onRowActivate = vi.fn();
    renderWithDesign(
      <Table caption="Regions" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} onRowActivate={onRowActivate} selectedKey="b" />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
    expect(rows[0]).toHaveAttribute("aria-selected", "false");
    await userEvent.click(rows[0] as HTMLElement);
    expect(onRowActivate).toHaveBeenLastCalledWith(ROWS[0]);
    (rows[1] as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    expect(onRowActivate).toHaveBeenLastCalledWith(ROWS[1]);
    await userEvent.keyboard(" ");
    expect(onRowActivate).toHaveBeenCalledTimes(3);
  });

  it("shows the empty content instead of a table when there are no rows", () => {
    renderWithDesign(
      <Table caption="Regions" columns={COLUMNS} rows={[]} rowKey={(row) => row.id} empty={<p>No regions.</p>} />,
    );
    expect(screen.getByText("No regions.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("decision tags", () => {
  it("draws kept, rebuilt and unassessed with different shapes, not only different colours", () => {
    const { container } = renderWithDesign(
      <>
        <DecisionTag decision="kept" />
        <DecisionTag decision="rebuilt" />
        <DecisionTag decision="unassessed" />
      </>,
    );
    const glyphs = [...container.querySelectorAll(".rh-glyph")].map((node) => node.className);
    expect(glyphs).toEqual(["rh-glyph rh-glyph-kept", "rh-glyph rh-glyph-rebuilt", "rh-glyph rh-glyph-unassessed"]);
    expect(new Set(glyphs).size).toBe(3);
    expect(screen.getByText("Kept")).toBeInTheDocument();
    expect(screen.getByText("Rebuilt")).toBeInTheDocument();
    expect(screen.getByText("Unassessed")).toBeInTheDocument();
  });

  it("hides the bare glyph from assistive technology and accepts custom text", () => {
    const { container } = renderWithDesign(
      <>
        <DecisionGlyph decision="kept" />
        <DecisionTag decision="rebuilt">Rebuilt, 12 regions</DecisionTag>
      </>,
    );
    expect(container.querySelector(".rh-glyph-kept")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Rebuilt, 12 regions")).toBeInTheDocument();
  });
});

describe("status and bars", () => {
  it("StatusDot is labelled when it carries meaning and hidden when it does not", () => {
    const { container } = renderWithDesign(
      <>
        <StatusDot tone="err" label="Failed" />
        <StatusDot tone="ok" />
      </>,
    );
    expect(screen.getByRole("img", { name: "Failed" })).toHaveClass("rh-st-err");
    expect(container.querySelector(".rh-st-ok")).toHaveAttribute("aria-hidden", "true");
  });

  it("StatusTag pairs the dot with text", () => {
    renderWithDesign(<StatusTag tone="run">Indexing</StatusTag>);
    expect(screen.getByText("Indexing")).toBeInTheDocument();
  });

  it("SplitBar sizes segments by their share and names itself", () => {
    const { container } = renderWithDesign(
      <SplitBar
        label="38 kept, 248 rebuilt"
        segments={[
          { kind: "kept", value: 1 },
          { kind: "rebuilt", value: 3 },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: "38 kept, 248 rebuilt" })).toBeInTheDocument();
    const widths = [...container.querySelectorAll<HTMLElement>(".rh-bar i")].map((node) => node.style.width);
    expect(widths).toEqual(["25%", "75%"]);
  });

  it("SplitBar draws nothing for zero or negative values and for an empty total", () => {
    const { container } = renderWithDesign(
      <>
        <SplitBar label="none" segments={[{ kind: "kept", value: 0 }]} />
        <SplitBar
          label="mixed"
          segments={[
            { kind: "kept", value: -2 },
            { kind: "rebuilt", value: 2 },
          ]}
        />
      </>,
    );
    expect(container.querySelectorAll(".rh-bar")[0]?.querySelectorAll("i")).toHaveLength(0);
    expect([...(container.querySelectorAll(".rh-bar")[1]?.querySelectorAll<HTMLElement>("i") ?? [])].map((n) => n.style.width)).toEqual(["100%"]);
  });

  it("Meter reports its value and clamps the fill", () => {
    const { container } = renderWithDesign(
      <>
        <Meter value={2} max={5} label="Indexes used today" />
        <Meter value={9} max={5} label="Over" />
        <Meter value={1} max={0} label="No limit" />
      </>,
    );
    const meter = screen.getByRole("meter", { name: "Indexes used today" });
    expect(meter).toHaveAttribute("aria-valuenow", "2");
    expect(meter).toHaveAttribute("aria-valuemax", "5");
    const fills = [...container.querySelectorAll<HTMLElement>(".rh-meter i")].map((node) => node.style.width);
    expect(fills).toEqual(["40%", "100%", "0%"]);
  });
});

describe("feedback and text", () => {
  it("an error Alert announces itself; a warning does not", () => {
    renderWithDesign(
      <>
        <Alert title="Failed">The index failed.</Alert>
        <Alert tone="warn" title="Already indexed" />
      </>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Failed");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("EmptyState says why and offers the next step", () => {
    renderWithDesign(<EmptyState title="Nothing indexed yet" action={<button type="button">Index one</button>}>Index a public Java repository.</EmptyState>);
    expect(screen.getByText("Nothing indexed yet")).toBeInTheDocument();
    expect(screen.getByText("Index a public Java repository.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Index one" })).toBeInTheDocument();
  });

  it("Text picks its size from a role and nothing else", () => {
    renderWithDesign(
      <>
        <Text role="title" as="h1">
          Repositories
        </Text>
        <Text role="body" figure tone="subtle">
          29,190
        </Text>
      </>,
    );
    expect(screen.getByRole("heading", { name: "Repositories" })).toHaveClass("rh-t-title");
    expect(screen.getByText("29,190")).toHaveClass("rh-t-body", "rh-fig", "rh-tone-subtle");
  });

  it("Page narrows on request", () => {
    const { container } = renderWithDesign(
      <>
        <Page>a</Page>
        <Page narrow>b</Page>
      </>,
    );
    const pages = container.querySelectorAll(".rh-page");
    expect(pages[0]).not.toHaveClass("rh-page-narrow");
    expect(pages[1]).toHaveClass("rh-page-narrow");
  });
});
