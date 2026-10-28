import assert from 'node:assert/strict'
import { test } from 'node:test'
import { projectInputSchema } from './projects.js'

const validProject = {
  title: 'Accessible portfolio redesign',
  description: 'Build a responsive portfolio with clear project case studies.',
  budget: '250.00',
  durationDays: 14,
  requirements: ['Responsive layouts', 'Accessible navigation'],
}

test('project publishing accepts valid content and applies marketplace defaults', () => {
  const result = projectInputSchema.parse(validProject)

  assert.equal(result.title, validProject.title)
  assert.deepEqual(result.requirements, validProject.requirements)
  assert.deepEqual(result.skills, [])
  assert.equal(result.experienceLevel, 'Intermediate')
  assert.equal(result.remote, true)
})

test('project publishing rejects invalid title, description, budget, and duration', () => {
  const result = projectInputSchema.safeParse({
    ...validProject,
    title: 'dwa',
    description: 'Too short',
    budget: '0',
    durationDays: 0,
    deadline: '2020-01-01T00:00:00.000Z',
    requirements: [],
  })

  assert.equal(result.success, false)
  if (!result.success) {
    const fields = result.error.flatten().fieldErrors
    assert.ok(fields.title)
    assert.ok(fields.description)
    assert.ok(fields.budget)
    assert.ok(fields.durationDays)
    assert.ok(fields.deadline)
    assert.ok(fields.requirements)
  }
})
