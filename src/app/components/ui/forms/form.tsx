"use client";

import * as React from "react";
import {
  FormProvider,
  useForm,
  type DefaultValues,
  type FieldValues,
} from "react-hook-form";
import { cn } from "@/app/components/ui/utils";
import { FormContext, type FormCol, type FormLayout } from "./form-context";
import { FormItem } from "./form-item";

export type FormProps<T extends FieldValues = FieldValues> = {
  initialValues?: DefaultValues<T>;
  onFinish?: (values: T) => void;
  onFinishFailed?: (errors: unknown) => void;
  onValuesChange?: (changedValues: Partial<T>, allValues: T) => void;
  layout?: FormLayout;
  labelCol?: FormCol;
  wrapperCol?: FormCol;
  /** horizontal 布局下 label 列固定宽度（px 或 CSS 长度） */
  labelWidth?: number | string;
  className?: string;
  children?: React.ReactNode;
};

const getValueAtPath = (values: FieldValues, path: string): unknown => {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, values);
};

const FormInner = <T extends FieldValues>({
  initialValues,
  onFinish,
  onFinishFailed,
  onValuesChange,
  layout = "vertical",
  labelCol,
  wrapperCol,
  labelWidth,
  className,
  children,
}: FormProps<T>) => {
  const methods = useForm<T>({ defaultValues: initialValues });
  const initialValuesRef = React.useRef(initialValues);
  const onValuesChangeRef = React.useRef(onValuesChange);
  onValuesChangeRef.current = onValuesChange;

  React.useEffect(() => {
    if (initialValuesRef.current !== initialValues) {
      initialValuesRef.current = initialValues;
      methods.reset(initialValues);
    }
  }, [initialValues, methods]);

  React.useEffect(() => {
    const subscription = methods.watch((_values, info) => {
      if (!onValuesChangeRef.current || !info.name || info.type !== "change") return;
      const allValues = methods.getValues();
      const fieldPath = String(info.name);
      onValuesChangeRef.current(
        { [fieldPath]: getValueAtPath(allValues, fieldPath) } as Partial<T>,
        allValues,
      );
    });

    return () => subscription.unsubscribe();
  }, [methods]);

  return (
    <FormProvider {...methods}>
      <FormContext.Provider value={{ layout, labelCol, wrapperCol, labelWidth }}>
        <form
          className={cn("min-w-0 w-full", className)}
          onSubmit={methods.handleSubmit(
            (values) => onFinish?.(values),
            (errors) => onFinishFailed?.(errors),
          )}
          noValidate
        >
          {children}
        </form>
      </FormContext.Provider>
    </FormProvider>
  );
};

export const Form = Object.assign(FormInner, { Item: FormItem });
