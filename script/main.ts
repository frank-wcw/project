import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import { parse } from '@textlint/markdown-to-ast'
import { select, confirm } from '@inquirer/prompts'
import simpleGit from 'simple-git'
import { rimrafSync } from 'rimraf'
import { findUpSync } from 'find-up'

const NODE_ENV = process.env.NODE_ENV || 'development'
const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageJsonPath = findUpSync('package.json', { cwd: __dirname })
const projectPath = path.dirname(packageJsonPath)
const readmeFilepath = path.join(projectPath, 'readme.md')
const projectRootDir = path.join(projectPath, 'project')
const git = simpleGit(projectPath)

type ListItem = {
  topicName: string
  projectList: Project[]
}

type Project = {
  name: string
  repositoryUrl: string
  description: string
  projectName: string
  projectDir: string
  isLocalExists: boolean
}

checkPullGit().then(run)

async function run () {
  const list = readmeToList()
  // console.log(JSON.stringify(list, null, 2))
  // return

  if (!list.length) {
    console.log('沒有可以克隆的項目，請更新 readme 以獲取項目克隆選項')
    return
  }

  createAnswer(list)
}

async function checkNeedsPullGit () {
  try {
    await git.remote(['update'])
    const status = await git.status()
    return status.behind > 0;
  } catch (error) {
    console.error('檢查 GIT 狀態時發生錯誤:', error)
  }

  return false
}

async function checkPullGit () {
  const needsPull = await checkNeedsPullGit()
  if (needsPull) {
    console.log('檢測本地版本落後，將 pull 以拉取最新的 readme 配置...')
    await git.pull()
    console.log('倉庫已更新，開始運行後續腳本')
  }
}

async function createAnswer(list: ListItem[]) {
  let topicIndex: number
  let project: Project

  try {
    topicIndex = await select({
      message: '請選擇主題',
      choices: list.map((e, i) => ({
        name: `${i + 1}. ${e.topicName}`,
        value: i,
      })),
    })

    project = await select({
      message: '請選擇專案',
      choices: list[topicIndex].projectList.map((e, i) => ({
        name: `${i + 1}. ${e.name}`,
        description: `     ${e.description}`,
        value: e,
      })),
    })
  } catch { return }

  cloneRepository(project)
}

async function cloneRepository(project: Project) {
  try {
    if (fs.existsSync(projectRootDir)) {
      if (fs.existsSync(project.projectDir)) {
        const isWantDelete = await confirm({
          message: `已包含該專案(${project.projectName})目錄，請問是否要刪除並重新克隆呢？`,
        })
        if (!isWantDelete) {
          console.log(`已取消`)
          return
        }
        rimrafSync(project.projectDir)
        console.log(`已刪除專案目錄，將為您開始重新克隆`)
      }
    } else {
      fs.mkdirSync(projectRootDir, { recursive: true })
    }

    console.log(`正在克隆 ${project.projectName}...`)
    await git.clone(project.repositoryUrl, project.projectDir)
    console.log(`成功克隆到 ${project.projectDir}`)
  } catch (error) {
    console.error('克隆失敗:', error)
  }
}

function readmeToList () {
  const readme = fs.readFileSync(readmeFilepath, 'utf8')
  const AST = parse(readme)
  const list: ListItem[] = []

  let current: ListItem | null = null

  AST.children.forEach(e => {
    if (e.type === 'Header') {
      if (e.depth === 2) {
        checkRemoveEmptyListItem()

        current = {
          topicName: e.children[0].raw,
          projectList: [],
        }

        list.push(current)
      }
    } else if (e.type === 'List') {
      if (current == null) return
      e.children.forEach(f => {
        const paragraph = f.children[0]
        if (paragraph.type === 'Paragraph') {
          const [link, str] = paragraph.children

          if (link.type === 'Link' && checkValidGithubRepositoryUrl(link.url)) {
            let repositoryUrl = link.url
            if (!/\.git$/.test(repositoryUrl)) {
              repositoryUrl += '.git'
            }

            const name = link.children[0].raw
            current.projectList.push({
              ...toSpecificProjectKeyValue(name, repositoryUrl),
              repositoryUrl,
              description: str?.raw.trim() || '',
            })
          }
        }
      })
    } else if (e.type === 'Html') {
      const [, textContent] = e.raw.match(/^<!--PRIVATE_START([\w\W]+)PRIVATE_END-->$/m) || []

      if (textContent) {
        const listItem: ListItem = {
          topicName: '*未公開',
          projectList: [],
        }

        textContent.split('---').forEach(e => {
          const result: Partial<Record<'name'|'repositoryUrl'|'desc', string>> = {}
          const kvList = e.trim().split('\n')
          kvList.forEach(f => {
            const [, key, val] = f.match(/^@(\w+):([^\r\n]+)[\r\n]*$/) || []
            if (key && val) {
              result[key] = val
            }
          })
          if (result.name && result.repositoryUrl) {
            const name = result.name
            listItem.projectList.push({
              ...toSpecificProjectKeyValue(name, result.repositoryUrl),
              repositoryUrl: result.repositoryUrl,
              description: result.desc,
            })
          }
        })

        if (listItem.projectList.length > 0) list.push(listItem)
      }
    }
  })

  checkRemoveEmptyListItem()

  function checkRemoveEmptyListItem () {
    const lastListItem = list[list.length - 1]
    if (lastListItem != null) {
      if (!lastListItem.projectList.length) {
        list.splice(list.length - 1, 1)
      }
    }
  }

  return list
}

function toSpecificProjectKeyValue (name: string, repositoryUrl: string) {
  const projectName = (repositoryUrl.match(/([^\/\\]+)\.git$/) || [])[1] || name
  const projectDir = path.join(projectRootDir, projectName)
  const isLocalExists = fs.existsSync(projectDir)
  return {
    name: `${isLocalExists ? '[EXISTS] ' : ''}${name}`,
    projectName,
    projectDir,
    isLocalExists,
  }
}

function checkValidGithubRepositoryUrl(url: string) {
  const urlPattern = /^https:\/\/github\.com\/[A-z0-9-_\/]+$/;
  return urlPattern.test(url);
}