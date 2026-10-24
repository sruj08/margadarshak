"use client";

import { Drawer } from "@heroui/react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";

/**
 * Sheet (bottom Drawer; DESIGN_SYSTEM §11.2 "Modal, Drawer"). Rises from the bottom, focus is trapped
 * and returned to the trigger, and there is always a visible Close button: drag is never the only way
 * to dismiss (WCAG 2.5.7). Controlled: pass `isOpen` + `onOpenChange`.
 */
export interface SheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Optional one-line description under the title. */
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Localised accessible name for the close button. */
  closeLabel: string;
  placement?: "bottom" | "right";
  isDismissable?: boolean;
  className?: string;
}

export function Sheet({
  isOpen,
  onOpenChange,
  title,
  description,
  children,
  footer,
  closeLabel,
  placement = "bottom",
  isDismissable = true,
  className,
}: SheetProps) {
  return (
    <Drawer.Backdrop
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={isDismissable}
      className="md-sheet-backdrop"
    >
      <Drawer.Content
        placement={placement}
        className={cx("md-sheet", `md-sheet--${placement}`, className)}
      >
        <Drawer.Dialog className="md-sheet__dialog">
          {placement === "bottom" ? <Drawer.Handle className="md-sheet__handle" /> : null}
          <Drawer.CloseTrigger className="md-sheet__close" aria-label={closeLabel} />
          <Drawer.Header className="md-sheet__header">
            <Drawer.Heading className="md-sheet__title">{title}</Drawer.Heading>
            {description ? <p className="md-sheet__description">{description}</p> : null}
          </Drawer.Header>
          <Drawer.Body className="md-sheet__body">{children}</Drawer.Body>
          {footer ? <Drawer.Footer className="md-sheet__footer">{footer}</Drawer.Footer> : null}
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
