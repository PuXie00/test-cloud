// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/app/auth/auth-provider";
import { installFakeAuthApi, uninstallFakeAuthApi } from "@/app/auth/install-fake-auth-api";
import { LAST_USERNAME_STORAGE_KEY } from "@/app/auth/last-username";
import { LoginForm } from "./login-form";

afterEach(() => {
  cleanup();
  uninstallFakeAuthApi();
  localStorage.clear();
});

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const renderForm = async (props: { prefillLastUsername?: boolean } = {}) => {
  const onSuccess = vi.fn();
  render(
    <AuthProvider>
      <LoginForm onSuccess={onSuccess} {...props} />
    </AuthProvider>,
  );
  await screen.findByLabelText("用户名");
  return onSuccess;
};

describe("LoginForm", () => {
  it("用户名或密码错误时提示", async () => {
    installFakeAuthApi();
    const onSuccess = await renderForm();
    type("用户名", "op");
    type("密码 / Password", "bad");
    fireEvent.click(screen.getByRole("button", { name: "登 录" }));
    expect(await screen.findByText("用户名或密码错误")).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("首次登录先设置新密码，两次不一致、和原密码相同都拦住", async () => {
    const { state } = installFakeAuthApi({ username: "admin", password: "admin123", mustChangePassword: true });
    const onSuccess = await renderForm();
    type("用户名", "admin");
    type("密码 / Password", "admin123");
    fireEvent.click(screen.getByRole("button", { name: "登 录" }));
    expect(await screen.findByText(/首次登录或密码已被重置/)).toBeTruthy();

    type("新密码（至少 4 位）", "abcd");
    type("再次输入新密码", "abce");
    fireEvent.click(screen.getByRole("button", { name: "修改密码并登录" }));
    expect(await screen.findByText("两次输入的新密码不一致")).toBeTruthy();

    type("新密码（至少 4 位）", "admin123");
    type("再次输入新密码", "admin123");
    fireEvent.click(screen.getByRole("button", { name: "修改密码并登录" }));
    expect(await screen.findByText("新密码不能和原密码相同")).toBeTruthy();

    type("新密码（至少 4 位）", "s3cret");
    type("再次输入新密码", "s3cret");
    fireEvent.click(screen.getByRole("button", { name: "修改密码并登录" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(state.password).toBe("s3cret");
  });

  it("记住上次登录的用户名：下次打开预填，光标在密码框", async () => {
    installFakeAuthApi();
    await renderForm();
    expect((screen.getByLabelText("用户名") as HTMLInputElement).value).toBe("");
    type("用户名", "OP");
    type("密码 / Password", "1234");
    fireEvent.click(screen.getByRole("button", { name: "登 录" }));
    // 存账号本来的写法，不是输入时的大小写
    await waitFor(() => expect(localStorage.getItem(LAST_USERNAME_STORAGE_KEY)).toBe("op"));
    cleanup();

    await renderForm();
    expect((screen.getByLabelText("用户名") as HTMLInputElement).value).toBe("op");
    expect(document.activeElement).toBe(screen.getByLabelText("密码 / Password"));
  });

  it("登录失败不改记住的用户名", async () => {
    installFakeAuthApi();
    localStorage.setItem(LAST_USERNAME_STORAGE_KEY, "op");
    await renderForm();
    type("用户名", "nobody");
    type("密码 / Password", "bad");
    fireEvent.click(screen.getByRole("button", { name: "登 录" }));
    expect(await screen.findByText("用户名或密码错误")).toBeTruthy();
    expect(localStorage.getItem(LAST_USERNAME_STORAGE_KEY)).toBe("op");
  });

  it("不预填时用户名为空，光标在用户名", async () => {
    installFakeAuthApi();
    localStorage.setItem(LAST_USERNAME_STORAGE_KEY, "op");
    await renderForm({ prefillLastUsername: false });
    expect((screen.getByLabelText("用户名") as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(screen.getByLabelText("用户名"));
  });
});
