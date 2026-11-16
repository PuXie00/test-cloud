; electron-builder NSIS 安装包钩子（electron-builder.json 的 nsis.include）。
; 改了要在 Windows 上打包实测：建工程后升级、回退（装旧版本）、卸载，Project 都要还在。

; 工程放在 <安装目录>\Project。升级、回退时安装包会先运行已装版本的卸载程序（带 --updated），
; 模板默认会把整个安装目录删掉（app-builder-lib templates/nsis/uninstaller.nsh）。
; 这里替换掉删除那一步：先把 Project 挪到安装目录旁边（同一个盘，只是改名），
; 照模板原样删安装目录（升级时整体挪走，有文件被占用就全部还原并中止），删完再把 Project 挪回去。
; 中途断电之类没挪回去的，软件启动时会挪回去（electron/main/project/kept-projects.ts）。
; 必须用模板自己的 un.atomicRMDir / un.restoreFiles：打包带 -WX，模板函数没被调用会报警告导致失败。

; 和 electron/main/project/paths.ts 的 KEPT_PROJECTS_SUFFIX 一致，改的话两边一起改
!define YZ_KEPT_SUFFIX ".project-keep"

!macro yzPutProjectsBack
  ${If} ${FileExists} "$INSTDIR${YZ_KEPT_SUFFIX}\*.*"
    CreateDirectory "$INSTDIR"
    ClearErrors
    Rename "$INSTDIR${YZ_KEPT_SUFFIX}" "$INSTDIR\Project"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONEXCLAMATION "工程没能放回 $INSTDIR\Project，现在在 $INSTDIR${YZ_KEPT_SUFFIX}。$\r$\n软件下次启动时会再放回去，也可以手动改名回去。" /SD IDOK
    ${EndIf}
  ${EndIf}
!macroend

!macro customRemoveFiles
  ${If} ${FileExists} "$INSTDIR\Project\*.*"
    ; 上次没挪回去的还在：不能覆盖它
    ${If} ${FileExists} "$INSTDIR${YZ_KEPT_SUFFIX}\*.*"
      MessageBox MB_OK|MB_ICONSTOP "$INSTDIR${YZ_KEPT_SUFFIX} 里是上次没放回去的工程。$\r$\n请先打开一次软件（会自动放回），或手动处理后再升级 / 卸载。" /SD IDOK
      Abort "工程备份目录已存在"
    ${EndIf}
    ClearErrors
    Rename "$INSTDIR\Project" "$INSTDIR${YZ_KEPT_SUFFIX}"
    ${If} ${Errors}
      ; 工程里有文件被占用（比如 C++ 还开着 logs.db）：什么都不删
      Abort "工程目录有文件被占用，请关闭软件后再试"
    ${EndIf}
  ${EndIf}

  ; 以下同模板默认的删除，只是中止前先把工程挪回去
  ${if} ${isUpdated}
    CreateDirectory "$PLUGINSDIR\old-install"

    Push ""
    Call un.atomicRMDir
    Pop $R0

    ${if} $R0 != 0
      DetailPrint "File is busy, aborting: $R0"

      Push ""
      Call un.restoreFiles
      Pop $R0

      !insertmacro yzPutProjectsBack
      Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
    ${endif}
  ${endif}

  SetOutPath $TEMP
  RMDir /r $INSTDIR

  !insertmacro yzPutProjectsBack

  ; 真卸载（不是升级、回退）时告诉用户工程还在
  ${IfNot} ${isUpdated}
  ${AndIf} ${FileExists} "$INSTDIR\Project\*.*"
    MessageBox MB_OK|MB_ICONINFORMATION "工程保留在 $INSTDIR\Project。$\r$\n重新安装到同一位置会继续使用；不需要的话可以手动删除。" /SD IDOK
  ${EndIf}
!macroend
