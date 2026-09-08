import { test, expect } from '@playwright/test'

const todos = [
  { id: 1, userId: 1, title: 'Review the TanStack query flow', completed: false },
  { id: 2, userId: 1, title: 'Ship the example', completed: true },
]

test.beforeEach(async ({ page }) => {
  await page.route('**/todos**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (url.hostname !== 'jsonplaceholder.typicode.com' || url.pathname !== '/todos') {
      await route.continue()
      return
    }

    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(todos),
      })
      return
    }

    if (request.method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 3,
          userId: 1,
          title: 'Review TIRAI integration',
          completed: false,
        }),
      })
      return
    }

    await route.continue()
  })
})

test('home dashboard navigates to the Todos example', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle('TanStack Full Demo')
  await expect(page.getByRole('heading', { name: 'TanStack Full Demo' })).toBeVisible()

  await page.getByRole('link', { name: 'Todos', exact: true }).click()

  await expect(page).toHaveURL(/\/todos$/)
  await expect(page.getByRole('heading', { name: 'Todos' })).toBeVisible()
})

test('Todos adds a task and filters it through the global store', async ({ page }) => {
  await page.goto('/todos')

  await expect(page.getByText('Review the TanStack query flow', { exact: true })).toBeVisible()

  await page.getByPlaceholder('Add a new task...', { exact: true }).fill('Review TIRAI integration')
  await page.getByRole('button', { name: 'Add', exact: true }).click()

  await expect(page.getByText('Review TIRAI integration', { exact: true })).toBeVisible()

  await page.getByPlaceholder('Search todos... (TanStack Store)', { exact: true }).fill('TIRAI')
  await expect(page.getByText('Review TIRAI integration', { exact: true })).toBeVisible()
  await expect(page.getByText('Review the TanStack query flow', { exact: true })).toBeHidden()
})
