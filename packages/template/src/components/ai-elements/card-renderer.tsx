"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type {
  ActionsElement,
  ButtonElement,
  CardElement,
  DividerElement,
  FieldsElement,
  ImageElement,
  SectionElement,
  TextElement,
} from "@modules/messaging/lib/card-serialization";
import type { ComponentProps } from "react";
import { useState } from "react";

export interface CardRendererProps extends ComponentProps<typeof Card> {
  card: CardElement;
  onAction?: (actionId: string, value?: string) => void;
  readOnly?: boolean;
}

// ─── Child renderers ─────────────────────────────────────────────────

function renderText(el: TextElement, key: string) {
  const baseClass = "text-sm leading-relaxed";
  const styleClass =
    el.style === "bold"
      ? "font-semibold"
      : el.style === "muted"
        ? "text-muted-foreground"
        : "";
  return (
    <p className={cn(baseClass, styleClass)} key={key}>
      {el.content}
    </p>
  );
}

function renderImage(el: ImageElement, key: string) {
  return (
    <img
      alt={el.alt ?? ""}
      className="w-full rounded-md object-cover"
      key={key}
      src={el.url}
    />
  );
}

function renderDivider(_el: DividerElement, key: string) {
  return <Separator className="my-1" key={key} />;
}

function renderFields(el: FieldsElement, key: string) {
  return (
    <dl
      className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
      key={key}
    >
      {el.children.map((field, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fields have no unique id
        <div className="contents" key={i}>
          <dt className="font-medium text-muted-foreground">{field.label}</dt>
          <dd>{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ─── Actions group ────────────────────────────────────────────────────

interface ActionsGroupProps {
  el: ActionsElement;
  groupKey: string;
  onAction?: (actionId: string, value?: string) => void;
  readOnly?: boolean;
}

function ActionsGroup({ el, groupKey, onAction, readOnly }: ActionsGroupProps) {
  const [clicked, setClicked] = useState(false);

  return (
    <div className="flex flex-wrap gap-2" key={groupKey}>
      {el.children.map((child, i) => {
        if (child.type === "button") {
          const btn = child as ButtonElement;
          const isDisabled = readOnly || clicked || btn.disabled;
          return (
            <Button
              // biome-ignore lint/suspicious/noArrayIndexKey: buttons have no unique key
              key={i}
              disabled={isDisabled}
              onClick={() => {
                if (isDisabled) return;
                setClicked(true);
                onAction?.(btn.id, btn.value);
              }}
              size="sm"
              type="button"
              variant={btn.style === "danger" ? "destructive" : "default"}
            >
              {btn.label}
            </Button>
          );
        }
        if (child.type === "link-button") {
          return (
            <Button
              // biome-ignore lint/suspicious/noArrayIndexKey: buttons have no unique key
              key={i}
              asChild={false}
              disabled={readOnly}
              onClick={() => window.open(child.url, "_blank", "noopener,noreferrer")}
              size="sm"
              type="button"
              variant="outline"
            >
              {child.label}
            </Button>
          );
        }
        return null;
      })}
    </div>
  );
}

// ─── Recursive child renderer ─────────────────────────────────────────

function renderSection(
  el: SectionElement,
  key: string,
  onAction?: (actionId: string, value?: string) => void,
  readOnly?: boolean,
) {
  return (
    <div className="space-y-2" key={key}>
      {el.children.map((child, i) =>
        renderChild(child, `${key}-${i}`, onAction, readOnly),
      )}
    </div>
  );
}

function renderChild(
  child: CardElement["children"][number],
  key: string,
  onAction?: (actionId: string, value?: string) => void,
  readOnly?: boolean,
): React.ReactNode {
  switch (child.type) {
    case "text":
      return renderText(child as TextElement, key);
    case "image":
      return renderImage(child as ImageElement, key);
    case "divider":
      return renderDivider(child as DividerElement, key);
    case "fields":
      return renderFields(child as FieldsElement, key);
    case "actions":
      return (
        <ActionsGroup
          el={child as ActionsElement}
          groupKey={key}
          key={key}
          onAction={onAction}
          readOnly={readOnly}
        />
      );
    case "section":
      return renderSection(child as SectionElement, key, onAction, readOnly);
    default:
      // Gracefully skip unknown/future element types
      return null;
  }
}

// ─── Root component ───────────────────────────────────────────────────

export const CardRenderer = ({
  card,
  onAction,
  readOnly = false,
  className,
  ...props
}: CardRendererProps) => {
  const hasHeader = !!(card.title || card.subtitle);

  return (
    <Card className={cn("w-full max-w-sm", className)} {...props}>
      {hasHeader && (
        <CardHeader className="pb-3">
          {card.title && <CardTitle className="text-base">{card.title}</CardTitle>}
          {card.subtitle && (
            <p className="text-sm text-muted-foreground">{card.subtitle}</p>
          )}
        </CardHeader>
      )}
      {card.children.length > 0 && (
        <CardContent className={cn("space-y-3", hasHeader ? "pt-0" : "pt-4")}>
          {card.imageUrl && (
            <img
              alt={card.title ?? ""}
              className="mb-3 w-full rounded-md object-cover"
              src={card.imageUrl}
            />
          )}
          {card.children.map((child, i) =>
            renderChild(child, `child-${i}`, onAction, readOnly),
          )}
        </CardContent>
      )}
    </Card>
  );
};
