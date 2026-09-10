import type { RegisterOptions } from "react-hook-form";

export type FormRule = {
  required?: boolean;
  message?: string;
  min?: number;
  max?: number;
  pattern?: RegExp;
  validator?: (value: unknown) => boolean | string | Promise<boolean | string>;
};

export const convertRules = (rules?: FormRule[]): RegisterOptions => {
  if (!rules?.length) return {};

  const options: RegisterOptions = {};
  const validators: Record<string, FormRule["validator"]> = {};

  for (const [index, rule] of rules.entries()) {
    if (rule.required) {
      options.required = rule.message ?? "必填项";
    }
    if (rule.min != null) {
      options.min = { value: rule.min, message: rule.message ?? `最小值为 ${rule.min}` };
    }
    if (rule.max != null) {
      options.max = { value: rule.max, message: rule.message ?? `最大值为 ${rule.max}` };
    }
    if (rule.pattern) {
      options.pattern = { value: rule.pattern, message: rule.message ?? "格式不正确" };
    }
    if (rule.validator) {
      validators[`custom_${index}`] = rule.validator;
    }
  }

  if (Object.keys(validators).length > 0) {
    options.validate = validators as RegisterOptions["validate"];
  }

  return options;
};
