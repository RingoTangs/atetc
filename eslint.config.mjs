import antfu from '@antfu/eslint-config'
import prettier from 'eslint-config-prettier'

export default antfu({
  type: 'lib',
  typescript: true,
  stylistic: false,
  formatters: false,
  gitignore: true,
  test: true,
  ignores: ['**/pnpm-lock.yaml'],
}).append(prettier)
