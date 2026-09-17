import { defineScenario } from '~/verify/lib'

// Parse error reached from the empty home's "选择文件" (the first file a new user picks): the notice's example file name
// is the synthetic stamp, never a sample's basename (overall critic r2 #1). Nothing is created.
export default defineScenario({
  id: 'import/parse-error-empty-home',
  description: '空首页选择一个不是 ZIP 的文件 → 导入浮层「无法识别这个文件」，示例文件名为合成时间戳',
  account: 'empty',
  async run({ page, step, shot, check, helpers, api }) {
    const dialog = page.getByRole('dialog')

    await step('empty home', async () => {
      await helpers.goto('/')
      await page.locator('[data-home-dropzone]').waitFor()
    })

    await step('choose a non-ZIP file', async () => {
      await helpers.setInputFiles('[data-home-file-input]', [{ name: 'broken.zip', buffer: Buffer.from('这不是一个 zip 文件'), mimeType: 'application/zip' }])
      await dialog.waitFor({ timeout: 15_000 })
      await dialog.getByText('无法识别这个文件').waitFor({ timeout: 15_000 })
      check('shows the chosen file name', await dialog.getByText('broken.zip', { exact: true }).isVisible())
      check('example name is the synthetic stamp', await dialog.getByText('聊天记录_20260101_120000.zip', { exact: true }).isVisible())
      const text = await dialog.innerText()
      const stamps = text.match(/聊天记录_\d{8}_\d{6}/g) ?? []
      check('no other export stamp in the notice', stamps.every((s) => s === '聊天记录_20260101_120000'), stamps.join(','))
    })
    await shot('parse-error', { fullPage: false })

    await step('close: nothing imported', async () => {
      await helpers.press('Escape')
      await dialog.waitFor({ state: 'hidden', timeout: 5000 })
      const home = await api.get<{ isEmpty: boolean }>('/api/home')
      check('account still empty', home.json?.isEmpty === true)
    })
  },
})
