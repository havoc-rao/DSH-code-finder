/**
 * Node 侧源码索引测试（plan §7）：声明提取（function / const 箭头 / class，
 * 跨行、泛型、大小写过滤）+ 搜索排序 + mtime 增量更新。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSourceIndex, extractComponentDeclarations } from '../src/index'

describe('extractComponentDeclarations', () => {
  it('提取 function / const 箭头 / class 声明，过滤小写工具函数', () => {
    const code = [
      'import { h } from "preact"',
      'export function Sidebar() {',
      '  return <div/>',
      '}',
      'const Toolbar = () => <span/>',
      'function helper() { return 1 }',
      'export default class Panel extends React.Component {}',
      'const item = (x) => x + 1',
    ].join('\n')
    const names = extractComponentDeclarations(code).map(c => c.name)
    expect(names).toEqual(['Sidebar', 'Toolbar', 'Panel'])
  })

  it('跨行箭头函数与泛型函数也命中', () => {
    const code = [
      'export const MultiLine = (',
      '  props: { a: string },',
      ') => {',
      '  return <div/>',
      '}',
      'export function Generic<T extends object>(props: T) {',
      '  return <div/>',
      '}',
    ].join('\n')
    const names = extractComponentDeclarations(code).map(c => c.name)
    expect(names).toEqual(['MultiLine', 'Generic'])
  })

  it('行/列是 1-based（babel loc 同款约定）', () => {
    const code = ['line0', 'export function Foo() {', '}'].join('\n')
    const [candidate] = extractComponentDeclarations(code)
    expect(candidate).toMatchObject({ name: 'Foo', line: 2, column: 17 })
  })
})

describe('createSourceIndex', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'code-finder-index-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const write = (relative: string, content: string): string => {
    const file = join(root, relative)
    mkdirSync(join(root, relative.split('/').slice(0, -1).join('/')), { recursive: true })
    writeFileSync(file, content)
    return file
  }

  it('扫 roots 建索引：精确名优先、包含名次之、同名多文件全返回', () => {
    write('src/components/Sidebar.tsx', 'export function Sidebar() { return <div/> }\nconst Toolbar = () => <span/>\n')
    write('src/legacy/Sidebar.jsx', 'function Sidebar() { return <h1/> }\n')
    write('src/App.ts', 'const SidebarList = (props) => <ul/>\n')
    const index = createSourceIndex({ roots: [root], exts: ['.tsx', '.jsx', '.ts'] })

    // 精确名在前（两个文件）、包含名在后
    const results = index.search('Sidebar')
    expect(results.map(c => c.name)).toEqual(['Sidebar', 'Sidebar', 'SidebarList'])
    expect(results[0]?.file).toContain('components/Sidebar.tsx')
    expect(results[1]?.file).toContain('legacy/Sidebar.jsx')
    expect(results[2]?.file).toContain('App.ts')

    expect(index.search('Nope')).toEqual([])
  })

  it('默认排除 node_modules 与产物目录', () => {
    write('src/Real.tsx', 'export function Real() { return <div/> }\n')
    write('node_modules/pkg/index.tsx', 'export function Fake() { return <div/> }\n')
    write('lib/Out.tsx', 'export function Out() { return <div/> }\n')
    const index = createSourceIndex({ roots: [root] })
    expect(index.search('Real').map(c => c.name)).toEqual(['Real'])
    expect(index.search('Fake')).toEqual([])
    expect(index.search('Out')).toEqual([])
  })

  it('mtime 增量更新：新增/修改/删除都能被下一次 search 感知', () => {
    const file = write('src/App.tsx', 'export function Old() { return <div/> }\n')
    const index = createSourceIndex({ roots: [root] })
    expect(index.search('Old')).toHaveLength(1)

    // 修改：换掉组件名
    writeFileSync(file, 'export function NewName() { return <div/> }\n')
    utimesSync(file, new Date(), new Date(Date.now() + 5000))
    expect(index.search('Old')).toEqual([])
    expect(index.search('NewName')).toHaveLength(1)

    // 新增文件
    write('src/Added.tsx', 'export function Added() { return <div/> }\n')
    expect(index.search('Added')).toHaveLength(1)

    // 删除文件
    rmSync(file)
    expect(index.search('NewName')).toEqual([])
  })

  it('候选带文件路径与 1-based 行列', () => {
    write('src/Panel.tsx', 'line0\nexport function Panel() {}\n')
    const [candidate] = createSourceIndex({ roots: [root] }).search('Panel')
    expect(candidate?.file).toContain('Panel.tsx')
    expect(candidate?.line).toBe(2)
    expect(candidate?.column).toBeGreaterThan(0)
  })

  it('lazy: true 创建不扫描，首次 search 才建表', () => {
    write('src/Lazy.tsx', 'export function LazyThing() { return <div/> }\n')
    const index = createSourceIndex({ roots: [root], lazy: true })
    // 创建时尚未扫描（此处无直接观测手段，用后续行为验证：首次 search 能命中）
    expect(index.search('LazyThing')).toHaveLength(1)
    // 二次 search 走增量路径，结果一致
    expect(index.search('LazyThing')).toHaveLength(1)
  })
})
