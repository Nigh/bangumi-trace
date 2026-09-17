import { readFile } from "node:fs/promises"
import { validateData } from "../shared/validation.ts"

const file = process.argv[2]
if (!file) {
  console.error("用法：npm run validate:data -- <bangumi-app.json>")
  process.exit(2)
}

try {
  const value: unknown = JSON.parse(await readFile(file, "utf8"))
  const error = validateData(value)
  if (error) throw new Error(`数据格式无效：${error}`)
  console.log(`${file}: 数据格式有效`)
} catch (error) {
  console.error(error instanceof SyntaxError ? `不是有效 JSON：${error.message}` : (error as Error).message)
  process.exit(1)
}
