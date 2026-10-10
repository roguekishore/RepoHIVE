// Tokens
export { COLOR_TOKENS, FONT_TOKENS, TEXT_ROLES, tokenRef, tokenVar } from "./tokens/names";
export type { ColorToken, FontToken, TextRole } from "./tokens/names";

// Routes
export { REPO_VIEWS, parseRepoPath, routes } from "./routes";
export type { RepoView } from "./routes";

// Canvas colours
export { domColorSource, luminance, mixColors, oklabToRgb, parseColor, readPalette, rgbaCss, watchPalette } from "./canvas/colors";
export type { CanvasPalette, ColorSource, Rgba } from "./canvas/colors";
export { useCanvasPalette } from "./canvas/use-canvas-palette";

// Canvas base: camera, deterministic layout, hit testing, the controller and its hook (see canvas/index.ts)
export * from "./canvas/index";

// Theme, provider, toast
export { THEME_STORAGE_KEY, ThemeProvider, applyTheme, isThemePreference, themeInitScript, useTheme } from "./theme/theme";
export type { ThemePreference, ThemeStorage } from "./theme/theme";
export { DesignProvider, useClient, useLink, useNavigate } from "./provider/design-provider";
export type { DesignProviderProps, LinkComponent, LinkProps } from "./provider/design-provider";
export { TOAST_DURATION_MS, ToastProvider, useToast } from "./provider/toast";

// Icons and the mark
export { ICON_NAMES, Icon } from "./icons/icons";
export type { IconName, IconProps } from "./icons/icons";
export { Brand, Mark, Wordmark } from "./icons/mark";
export type { MarkProps } from "./icons/mark";

// Components
export { Button, LinkButton } from "./components/button";
export type { ButtonProps, ButtonSize, ButtonVariant, LinkButtonProps } from "./components/button";
export { Field, Input, LabeledInput } from "./components/field";
export type { FieldProps, InputProps, LabeledInputProps } from "./components/field";
export { Chip, SegmentedControl, Select } from "./components/controls";
export type { ChipProps, SegmentedControlProps, SegmentedOption, SelectProps } from "./components/controls";
export { Kbd } from "./components/kbd";
export { KeyValueList, Panel } from "./components/panel";
export type { KeyValueItem, PanelProps } from "./components/panel";
export { Table } from "./components/table";
export type { SortDirection, SortState, TableColumn, TableProps } from "./components/table";
export { DecisionGlyph, DecisionTag, Meter, SplitBar, StatusDot, StatusTag } from "./components/status";
export type { BarSegment, BarSegmentKind, Decision, MeterProps, SplitBarProps, StatusTone } from "./components/status";
export { Alert, EmptyState, Page, Text } from "./components/feedback";
export type { AlertProps, EmptyStateProps, TextProps } from "./components/feedback";
export { Modal } from "./components/modal";
export type { ModalProps } from "./components/modal";

// Palette and frame
export { matchScore, rankMatches } from "./palette/match";
export { SearchPalette } from "./palette/search-palette";
export type { PaletteGroup, PaletteItem, SearchPaletteProps } from "./palette/search-palette";
export { AppFrame } from "./frame/app-frame";
export type { AppFrameProps, Crumb } from "./frame/app-frame";
export { globalNav, repoNav, repoViewLabel } from "./frame/nav";
export type { NavEntry } from "./frame/nav";
export { Inspector, StatusLine, Workspace } from "./frame/workspace";
export type { InspectorProps, WorkspaceProps } from "./frame/workspace";

// Contracts are also available on their own at "@repohive/design/contracts".
export * from "./contracts";

// Screens: one line per screen group. Each group lives in its own folder under ./screens/<slug>.
export * from "./screens/landing";
export * from "./screens/dashboard";
export * from "./screens/views";
export * from "./screens/map";
export * from "./screens/canvas-views";
export * from "./screens/account";
