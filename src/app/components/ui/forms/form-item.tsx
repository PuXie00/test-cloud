"use client";

import * as React from "react";
import { CircleHelp } from "lucide-react";
import { Controller, useFormContext } from "react-hook-form";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/app/components/ui/tooltip";
import { cn } from "@/app/components/ui/utils";
import { convertRules, type FormRule } from "./form-rules";
import { formErrorClass, formExtraClass, formLabelClass } from "./form-tokens";
import { resolveControlMeta, resolveHorizontalGridColumns, useFormLayout } from "./form-context";

export type FormItemProps = {
  name?: string | string[];
  label?: React.ReactNode;
  rules?: FormRule[];
  extra?: React.ReactNode;
  required?: boolean;
  valuePropName?: string;
  trigger?: string;
  noStyle?: boolean;
  /** 覆盖 Form 的 labelWidth */
  labelWidth?: number | string;
  /** 标签旁 ? 帮助说明（Tooltip）；可传字符串或图文 React 节点 */
  labelTitle?: React.ReactNode;
  className?: string;
  children?: React.ReactElement;
};

export const FormLabelHelp = ({
  label,
  labelTitle,
  required,
  horizontal,
}: {
  label: React.ReactNode;
  labelTitle?: React.ReactNode;
  required?: boolean;
  horizontal?: boolean;
}) => {
  const helpId = React.useId();

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1",
        horizontal && "pt-2",
      )}
    >
      <span className={cn(formLabelClass, "min-w-0 truncate")}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </span>
      {labelTitle ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm",
                "text-muted-foreground hover:bg-accent hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
              aria-label="字段说明"
              aria-describedby={helpId}
            >
              <CircleHelp className="h-3.5 w-3.5" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent
            id={helpId}
            side="top"
            sideOffset={6}
            className="max-w-72 px-2.5 py-2 text-left text-body-sm text-pretty"
          >
            {labelTitle}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
};

export const FormItem = ({
  name,
  label,
  rules,
  extra,
  required,
  valuePropName,
  trigger,
  noStyle = false,
  labelWidth: itemLabelWidth,
  labelTitle,
  className,
  children,
}: FormItemProps) => {
  const { control } = useFormContext();
  const { layout, labelCol, wrapperCol, labelWidth: formLabelWidth } = useFormLayout();

  if (!name || !children) {
    if (noStyle) return <>{children}</>;

    if (layout === "horizontal" && label != null) {
      const gridColumns = resolveHorizontalGridColumns(
        labelCol,
        wrapperCol,
        itemLabelWidth ?? formLabelWidth,
      );
      return (
        <div
          className={cn("grid min-w-0 w-full items-start gap-x-3 gap-y-1", className)}
          style={{ gridTemplateColumns: gridColumns }}
        >
          <FormLabelHelp label={label} labelTitle={labelTitle} horizontal />
          <div className="min-w-0 space-y-1">
            {children}
            {extra && <p className={formExtraClass}>{extra}</p>}
          </div>
        </div>
      );
    }

    return (
      <div className={cn("space-y-1.5", className)}>
        {label != null && (
          <FormLabelHelp label={label} labelTitle={labelTitle} />
        )}
        {children}
        {extra && <p className={formExtraClass}>{extra}</p>}
      </div>
    );
  }

  const meta = resolveControlMeta(children, {
    valuePropName,
    trigger,
  });

  const resolvedName = Array.isArray(name) ? name.join(".") : name;
  const childSlot = (children.props as { "data-slot"?: string })["data-slot"];

  return (
    <Controller
      name={resolvedName as never}
      control={control}
      rules={convertRules([
        ...(required ? [{ required: true, message: "必填项" }] : []),
        ...(rules ?? []),
      ])}
      render={({ field, fieldState }) => {
        const injectedProps: Record<string, unknown> = {
          [meta.valuePropName]: field.value,
          [meta.trigger]: field.onChange,
          onBlur: field.onBlur,
          "aria-invalid": fieldState.invalid || undefined,
        };

        // 仅原生 input 需要 ref/name；Select/Checkbox/NumericInput 等函数组件不可注入 ref
        if (childSlot === "input") {
          injectedProps.ref = field.ref;
          injectedProps.name = field.name;
        }

        const controlNode = React.cloneElement(children, injectedProps);
        const errorMessage = fieldState.error?.message;

        if (noStyle) return controlNode;

        if (layout === "horizontal") {
          const gridColumns = resolveHorizontalGridColumns(
            labelCol,
            wrapperCol,
            itemLabelWidth ?? formLabelWidth,
          );
          return (
            <div
              className={cn("grid min-w-0 w-full items-start gap-x-3 gap-y-1", className)}
              style={{ gridTemplateColumns: gridColumns }}
            >
              {label != null && (
                <FormLabelHelp
                  label={label}
                  labelTitle={labelTitle}
                  required={required}
                  horizontal
                />
              )}
              <div className="min-w-0 space-y-1">
                {controlNode}
                {errorMessage ? (
                  <p className={formErrorClass} role="alert">
                    {errorMessage}
                  </p>
                ) : (
                  extra && <p className={formExtraClass}>{extra}</p>
                )}
              </div>
            </div>
          );
        }

        return (
          <div className={cn("space-y-1.5", className)}>
            {label != null && (
              <FormLabelHelp
                label={label}
                labelTitle={labelTitle}
                required={required}
              />
            )}
            {controlNode}
            {errorMessage ? (
              <p className={formErrorClass} role="alert">
                {errorMessage}
              </p>
            ) : (
              extra && <p className={formExtraClass}>{extra}</p>
            )}
          </div>
        );
      }}
    />
  );
};
