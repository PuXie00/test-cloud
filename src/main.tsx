import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import { AuthProvider } from "@/app/auth/auth-provider";
import { LicenseProvider } from "@/app/license/license-provider";
import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";
import { ProjectProvider } from "@/app/project/project-provider";
import App from "./app/App";
import "./styles/index.css";

// Electron 生产态用 loadFile(file://)，BrowserRouter 无法匹配路由；HashRouter 兼容开发与打包
createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <DisplayLengthUnitProvider>
      <LicenseProvider>
        <AuthProvider>
          <ProjectProvider>
            <App />
          </ProjectProvider>
        </AuthProvider>
      </LicenseProvider>
    </DisplayLengthUnitProvider>
  </HashRouter>
);
