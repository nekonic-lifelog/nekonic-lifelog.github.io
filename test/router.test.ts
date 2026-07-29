// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ROUTES,
  navigate,
  openProject,
  parseAddress,
  projectHash,
  readAddress,
  replaceRoute,
} from '../src/lib/router'

beforeEach(() => {
  window.location.hash = ''
})

afterEach(() => {
  window.location.hash = ''
})

describe('주소 읽기 — 하위호환', () => {
  it('기존 라우트가 전부 그대로 읽힌다', () => {
    for (const route of ROUTES) {
      expect(parseAddress(`#${route}`)).toEqual({ route })
    }
  })

  it('빈 해시는 오늘이다', () => {
    expect(parseAddress('')).toEqual({ route: '/today' })
    expect(parseAddress('#')).toEqual({ route: '/today' })
  })

  it('모르는 경로는 오늘로 떨어진다', () => {
    expect(parseAddress('#/nope')).toEqual({ route: '/today' })
    expect(parseAddress('#/todos/extra')).toEqual({ route: '/today' })
  })

  it('탭은 네 개 그대로다', () => {
    for (const route of ['/today', '/todos', '/records', '/stats']) {
      expect((ROUTES as readonly string[]).includes(route)).toBe(true)
    }
  })
})

describe('프로젝트 상세 주소', () => {
  it('할 일 주소에 프로젝트 id를 실어 읽는다', () => {
    expect(parseAddress('#/todos?p=p1')).toEqual({ route: '/todos', projectId: 'p1' })
  })

  it('id는 해시 안에만 있고 경로는 그대로 /todos다', () => {
    expect(projectHash('p1')).toBe('#/todos?p=p1')
    expect(projectHash('p1').startsWith('#/todos')).toBe(true)
  })

  it('까다로운 문자가 든 id도 실어 나른다', () => {
    const id = 'a b&c=d#e'
    expect(parseAddress(projectHash(id))).toEqual({ route: '/todos', projectId: id })
  })

  it('빈 id는 상세가 아니라 목록이다', () => {
    expect(parseAddress('#/todos?p=')).toEqual({ route: '/todos' })
    expect(parseAddress('#/todos?')).toEqual({ route: '/todos' })
  })

  it('할 일이 아닌 라우트에서는 프로젝트 id를 읽지 않는다', () => {
    expect(parseAddress('#/stats?p=p1')).toEqual({ route: '/stats' })
    expect(parseAddress('#/today?p=p1')).toEqual({ route: '/today' })
  })

  it('같은 해시를 두 번 읽으면 같은 객체를 준다', () => {
    window.location.hash = projectHash('p1')
    expect(readAddress()).toBe(readAddress())
  })
})

describe('주소 옮기기', () => {
  it('프로젝트를 열면 주소가 바뀐다', () => {
    openProject('p1')
    expect(window.location.hash).toBe('#/todos?p=p1')
    expect(readAddress()).toEqual({ route: '/todos', projectId: 'p1' })
  })

  it('목록으로 옮기면 프로젝트 id가 빠진다', () => {
    openProject('p1')
    navigate('/todos')
    expect(window.location.hash).toBe('#/todos')
    expect(readAddress()).toEqual({ route: '/todos' })
  })

  it('되돌려 쓰기는 히스토리를 늘리지 않는다', () => {
    navigate('/todos')
    const before = window.history.length
    replaceRoute('/todos')
    expect(window.history.length).toBe(before)
    expect(window.location.hash).toBe('#/todos')
  })

  it('다른 라우트로 가도 프로젝트 id가 따라붙지 않는다', () => {
    openProject('p1')
    navigate('/stats')
    expect(window.location.hash).toBe('#/stats')
    expect(readAddress()).toEqual({ route: '/stats' })
  })
})
