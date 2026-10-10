import type { ComponentType, ReactNode } from "react";
import type { Crumb } from "../../frame/app-frame";

/**
 * What a framed screen tells the frame it sits in. The design package does not know the host's frame slot, so the route
 * shell injects a component that does: the screen renders it around its content and passes the crumbs and the actions.
 */
export interface DashboardFrameProps {
  readonly crumbs?: readonly Crumb[];
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
}

export type DashboardFrame = ComponentType<DashboardFrameProps>;
