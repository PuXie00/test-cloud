import { useAuth } from "@/app/auth/use-auth";
import { AgentShell } from "./dist/index.js";
import "./dist/style.css";

const AGENT_SERVER_URL = "http://127.0.0.1:3000";

export function AgentShellView() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) return null;

  return <AgentShell serverUrl={AGENT_SERVER_URL} />;
}
