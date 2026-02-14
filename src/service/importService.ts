/*
 * Copyright (c) 2023, Terwer . All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * This code is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2 only, as
 * published by the Free Software Foundation.  Terwer designates this
 * particular file as subject to the "Classpath" exception as provided
 * by Terwer in the LICENSE file that accompanied this code.
 *
 * This code is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
 * version 2 for more details (a copy is included in the LICENSE file that
 * accompanied this code).
 *
 * You should have received a copy of the GNU General Public License version
 * 2 along with this work; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA 02110-1301 USA.
 *
 * Please contact Terwer, Shenzhen, Guangdong, China, youweics@163.com
 * or visit www.terwer.space if you need additional information or have any
 * questions.
 */

import { workspaceDir } from "../Constants"
import { showMessage } from "siyuan"
import ImporterPlugin from "../index"
import {
  copyDir,
  getExports,
  isPC,
  removeEmptyLines,
  removeFootnotes,
  removeLinks,
  replaceImagePath,
} from "../utils/utils"
import { loadImporterConfig } from "../store/config"

export class ImportService {
  private static readonly tempImportRoot = "/temp/convert/pandoc"

  /**
   * 上传并转换，md、html 不上传
   *
   * @param pluginInstance
   * @param file
   */
  public static async uploadAndConvert(pluginInstance: ImporterPlugin, file: any) {
    const fromFilename = file.name

    // 修正文件名
    const originalFilename = fromFilename.substring(0, fromFilename.lastIndexOf("."))
    // 去除标题多余的空格，包括开始中间以及结尾的空格
    // const filename = originalFilename.replace(/\s+/g, "")
    const toFilename = `${originalFilename}.md`

    // 扩展名
    const ext = fromFilename.split(".").pop().toLowerCase()

    // md 直接返回
    if (ext === "md") {
      const toFilePath = `/temp/convert/pandoc/${toFilename}`
      pluginInstance.logger.info(`upload md file to ${toFilePath}`)
      const uploadResult = await pluginInstance.kernelApi.putFile(toFilePath, file)
      if (uploadResult.code !== 0) {
        showMessage(`${pluginInstance.i18n.msgFileUploadError}：${uploadResult.msg}`, 7000, "error")
        return
      }
      return {
        toFilePath: toFilePath,
        isMd: true,
      }
    }

    if (ext === "html") {
      if (isPC()) {
        pluginInstance.logger.info(`copying html assets...`)
        // 仅在客户端复制资源文件
        const filePath = file.path
        const lastSlashIndex = filePath.lastIndexOf("/")
        const dirPath = filePath.substring(0, lastSlashIndex)
        const path = window.require("path")
        const fullDirPath = path.join(dirPath, `${originalFilename}_files`)
        pluginInstance.logger.info("fullDirPath=>", fullDirPath)

        await copyDir(fullDirPath, `${workspaceDir}/temp/convert/pandoc/${originalFilename}_files`)
      }
    }

    // =================================================
    // 下面是非 html、 md文件的处理、先上传源文件，然后转换
    // =================================================

    const fromFilePath = `/temp/convert/pandoc/${fromFilename}`
    const toFilePath = `/temp/convert/pandoc/${toFilename}`

    // 文件上传
    const uploadFilePath = fromFilePath
    pluginInstance.logger.info(`upload file from ${uploadFilePath} to /temp/convert/pandoc`)
    const uploadResult = await pluginInstance.kernelApi.putFile(uploadFilePath, file)
    if (uploadResult.code !== 0) {
      showMessage(`${pluginInstance.i18n.msgFileUploadError}：${uploadResult.msg}`, 7000, "error")
      return
    }

    // 文件转换
    const fromAbsPath = `./../${fromFilename}`
    const toAbsPath = `./../${toFilename}`
    pluginInstance.logger.info(`convertPandoc from [${fromAbsPath}] to [${toAbsPath}]`)
    const convertResult = await pluginInstance.kernelApi.convertPandoc(fromAbsPath, toAbsPath)
    if (convertResult.code !== 0) {
      showMessage(`${pluginInstance.i18n.msgFileConvertError}：${convertResult.msg}`, 7000, "error")
      return
    }

    // 读取文件
    let mdText = (await pluginInstance.kernelApi.getFile(toFilePath, "text")) ?? ""
    if (mdText === "") {
      showMessage(pluginInstance.i18n.msgFileConvertEmpty, 7000, "error")
      return
    }

    // 文本处理
    const importConfig = await loadImporterConfig(pluginInstance)
    if (importConfig.bundledFnSwitch !== false) {
      pluginInstance.logger.info("Using bundled handler process text")
      // 删除目录中链接
      mdText = removeLinks(mdText)
      // 去除空行
      mdText = removeEmptyLines(mdText)
      // 资源路径
      mdText = replaceImagePath(mdText)
      // 去除脚注
      mdText = removeFootnotes(mdText)
    }

    // 自定义文本处理
    if (importConfig.customFnSwitch) {
      pluginInstance.logger.warn("Using custom handler process text")
      try {
        const customFn = importConfig.customFn
        const exportsFn = getExports(customFn)
        mdText = exportsFn(mdText)
      } catch (e) {
        showMessage(`${pluginInstance.i18n.customFnHandlerError} ${e.toString()}`, 5000, "error")
        throw e
      }
    }

    // 保存处理的最终文本
    await pluginInstance.kernelApi.saveTextData(`${toFilename}`, mdText)

    return {
      toFilePath: toFilePath,
      isMd: false,
    }
  }

  public static async singleImport(
    pluginInstance: ImporterPlugin,
    toFilePath: string,
    toNotebookId: string,
    isMd: boolean
  ) {
    // 导入 MD 文档
    // const localPath = isMd ? toFilePath : `${workspaceDir}${toFilePath}`
    const localPath = `${workspaceDir}${toFilePath}`
    const mdResult = await pluginInstance.kernelApi.importStdMd(localPath, toNotebookId, `/`)
    if (mdResult.code !== 0) {
      showMessage(`${pluginInstance.i18n.msgDocCreateFailed}=>${toFilePath}`, 7000, "error")
    }

    // 打开笔记本
    await pluginInstance.kernelApi.openNotebook(toNotebookId)

    showMessage(pluginInstance.i18n.msgImportSuccess, 5000, "info")
  }

  public static async multiImport(pluginInstance: ImporterPlugin, toNotebookId: string) {
    // 导入 MD 文档
    const localPath = `${workspaceDir}/temp/convert/pandoc`
    const mdResult = await pluginInstance.kernelApi.importStdMd(localPath, toNotebookId, `/`)
    if (mdResult.code !== 0) {
      showMessage(`${pluginInstance.i18n.msgDocCreateFailed}=>${localPath}`, 7000, "error")
    }

    // 打开笔记本
    await pluginInstance.kernelApi.openNotebook(toNotebookId)

    showMessage(pluginInstance.i18n.msgImportSuccess, 5000, "info")
  }

  public static async importWorkspaceZip(
    pluginInstance: ImporterPlugin,
    file: File,
    toNotebookId: string,
    targetDirName?: string
  ) {
    const dirName = targetDirName || this.normalizeDirName(file.name.replace(/\.zip$/i, ""))
    const zipPath = `${this.tempImportRoot}/${dirName}.zip`
    const unzipPath = `${this.tempImportRoot}/${dirName}`

    await pluginInstance.kernelApi.putFile(zipPath, file)
    const unzipResult = await pluginInstance.kernelApi.unzip(zipPath, unzipPath)
    if (unzipResult.code !== 0) {
      showMessage(`${pluginInstance.i18n.msgZipExtractError}：${unzipResult.msg}`, 7000, "error")
      return
    }

    const localPath = `${workspaceDir}${unzipPath}`
    const mdResult = await pluginInstance.kernelApi.importStdMd(localPath, toNotebookId, `/`)
    if (mdResult.code !== 0) {
      showMessage(`${pluginInstance.i18n.msgDocCreateFailed}=>${localPath}`, 7000, "error")
      return
    }

    await pluginInstance.kernelApi.openNotebook(toNotebookId)
    showMessage(pluginInstance.i18n.msgImportSuccess, 5000, "info")
  }

  public static async importFromGithub(pluginInstance: ImporterPlugin, repoUrl: string, toNotebookId: string) {
    const repoInfo = this.parseGithubRepoUrl(repoUrl)
    if (!repoInfo) {
      showMessage(pluginInstance.i18n.msgGithubUrlInvalid, 7000, "error")
      return
    }

    const { owner, repo } = repoInfo
    const repoApiUrl = `https://api.github.com/repos/${owner}/${repo}`
    const repoRes = await fetch(repoApiUrl)
    if (!repoRes.ok) {
      showMessage(`${pluginInstance.i18n.msgGithubFetchFailed}：${repoRes.status} ${repoRes.statusText}`, 7000, "error")
      return
    }

    const repoJson = await repoRes.json()
    const defaultBranch = repoJson.default_branch
    const zipUrl = `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${defaultBranch}`
    const zipRes = await fetch(zipUrl)
    if (!zipRes.ok) {
      showMessage(`${pluginInstance.i18n.msgGithubFetchFailed}：${zipRes.status} ${zipRes.statusText}`, 7000, "error")
      return
    }

    const zipBlob = await zipRes.blob()
    const zipFile = new File([zipBlob], `${repo}-${defaultBranch}.zip`, { type: "application/zip" })
    await this.importWorkspaceZip(pluginInstance, zipFile, toNotebookId, `${owner}-${repo}-${defaultBranch}`)
  }

  private static parseGithubRepoUrl(repoUrl: string) {
    try {
      const url = new URL(repoUrl.trim())
      if (url.hostname !== "github.com") {
        return null
      }

      const segments = url.pathname.split("/").filter(Boolean)
      if (segments.length < 2) {
        return null
      }

      return {
        owner: segments[0],
        repo: segments[1].replace(/\.git$/, ""),
      }
    } catch {
      return null
    }
  }

  private static normalizeDirName(name: string) {
    return name.replace(/[^\w.-]/g, "-")
  }

  //////////////////////////////////////////////////////////////////
  // private function
  //////////////////////////////////////////////////////////////////
}
