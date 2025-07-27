import { parse } from '@textlint/markdown-to-ast'
import type { TxtHeaderNode } from '@textlint/ast-node-types'
import * as fs from 'node:fs'

type ListItem = {
  topicName: string
  projectList: Project[]
}
type Project = {
  name: string
  repositoryUrl: string
  description: string
}
const list = readmeToList()

function readmeToList () {
  const readme = fs.readFileSync('./readme.md', 'utf8')
  const AST = parse(readme)
  const list: ListItem[] = []

  let current: ListItem | null = null

  AST.children.forEach(e => {
    if (e.type === 'Header') {
      if (e.depth === 2) {
        const lastListItem = list[list.length - 1]
        if (lastListItem != null) {
          if (!lastListItem.projectList.length) {
            list.splice(list.length - 1, 1)
          }
        }

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
          if (!str) return
          if (link.type === 'Link' && checkValidGithubRepositoryUrl(link.url)) {
            let repositoryUrl = link.url
            if (!/\.git$/.test(repositoryUrl)) {
              repositoryUrl += '.git'
            }
            current.projectList.push({
              name: link.children[0].raw,
              repositoryUrl,
              description: str.raw,
            })
          }
        }
      })
    }
  })

  return list
}

function checkValidGithubRepositoryUrl(url: string) {
  const urlPattern = /^https:\/\/github\.com\/[A-z0-9-_\/]+$/;
  return urlPattern.test(url);
}

console.log(JSON.stringify(list, null, 2))