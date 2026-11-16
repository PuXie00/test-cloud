import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import { AuthProvider } from "@/app/auth/auth-provider";
import { LicenseProvider } from "@/app/license/license-provider";
import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";
import { ProjectProvider } from "@/app/project/project-provider";
import App from "./app/App";
import "./styles/index.css";

// 路由用 hash，开发态与打包后的本地页面服务按同一套路径匹配
createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <LicenseProvider>
      <AuthProvider>
        <DisplayLengthUnitProvider>
          <ProjectProvider>
            <App />
          </ProjectProvider>
        </DisplayLengthUnitProvider>
      </AuthProvider>
    </LicenseProvider>
  </HashRouter>
);
