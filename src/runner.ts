import chalk from "chalk"
import commander from "commander"
import { existsSync } from "fs"
import { resolve, basename } from "path"
import { performance } from "perf_hooks"
import Shellwords from "shellwords-ts"
import { Command, CommandParser, CommandType, PackageScripts } from "./parser"
import { Spinner } from "./spinner"
import supportsColor from "supports-color"
import { spawn } from "child_process"

type CliOptions = { [key: string]: string }

class Runner {
  spinner = new Spinner()
  constructor(public pkg: PackageScripts, public options: CliOptions = {}) {}

  groupStart(cmd: Command, level = 0) {
    const text = this.formatCommand(cmd)
    if (this.options.flat) {
      console.log(text)
    } else {
      this.spinner.start(text, level)
    }
  }

  async runCommand(cmd: Command, level = -2) {
    if (cmd.type == CommandType.op) return

    let spinner
    if (cmd.type == CommandType.script) {
      if (level >= 0) {
        if (this.options.flat) console.log("❯ " + this.formatCommand(cmd))
        else spinner = this.spinner.start(this.formatCommand(cmd), level)
      }
    } else {
      if (cmd.args.length) {
        const args = Shellwords.split(cmd.args.join(" "))
        if (cmd.type == CommandType.bin)
          args[0] = `./node_modules/.bin/${args[0]}`

        const title = this.formatCommand(cmd)
        if (this.options.flat) console.log(title)
        const cmdSpinner = this.options.flat
          ? undefined
          : this.spinner.start(title, level)
        try {
          if (!this.options.dryRun) {
            await this.spawn(args[0], args.slice(1), level)
          }
          if (cmdSpinner) this.spinner.success(cmdSpinner)
        } catch (err) {
          if (cmdSpinner) this.spinner.error(cmdSpinner)
          throw err
        }
      }
    }
    try {
      for (const kid of cmd.kids) await this.runCommand(kid, level + 1)
      if (spinner) this.spinner.success(spinner)
    } catch (err) {
      if (spinner) this.spinner.error(spinner)
      throw err
    }
  }

  private formatCommand(cmd: Command) {
    if (cmd.type == CommandType.script) return chalk.white.bold(`${cmd.name}`)
    return (
      chalk.grey(`$ ${cmd.args[0]}`) +
      " " +
      cmd.args
        .slice(1)
        .map(x => {
          if (x.startsWith("-")) return chalk.cyan(x)
          if (existsSync(x)) return chalk.magenta(x)
          if (x.includes("*")) return chalk.yellow(x)
          return x
        })
        .join(" ")
    )
  }

  sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  spawn(cmd: string, args: string[], level: number) {
    const child = spawn(cmd, args, {
      stdio: this.options.flat && !this.options.silent ? "inherit" : "pipe",
      env: { ...process.env, FORCE_COLOR: chalk.level + "" },
    })

    const prefix = `${"".padEnd(level * 2)}${chalk.grey(`   │`)} `
    let output = ""

    const onData = (data: string) => {
      let ret = `${data}`.replace(/\n/g, `\n${prefix}`)
      if (!output.length) ret = prefix + ret
      output += ret
      if (!this.options.silent) {
        this.spinner.append(ret, false)
      }
    }

    return new Promise((resolve, reject) => {
      child.stdout?.on("data", onData)
      child.stderr?.on("data", onData)
      child.on("close", code => {
        if (code)
          reject(
            new Error(
              `${this.options.silent ? output : ""}\n${chalk.red(
                "error"
              )} Command ${chalk.white.dim(
                basename(cmd)
              )} failed with exit code ${chalk.red(code)}`
            )
          )
        else resolve()
      })
    })
  }

  formatDuration(duration: number) {
    if (duration < 1) return (duration * 1000).toFixed(0) + "ms"
    return duration.toFixed(3) + "s"
  }

  async run(cmd: string) {
    try {
      const command = new CommandParser(this.pkg).parse(cmd)
      await this.runCommand(command)
      this.spinner._stop()
      if (!this.options.silent) {
        console.log(
          "✨",
          this.options.dryRun ? "Dry-run done" : "Done",
          `in ${this.formatDuration(performance.nodeTiming.duration / 1000)}`
        )
      }
    } catch (err) {
      if (err instanceof Error) {
        console.error(err.message)
        // console.log(chalk.red("error"), `Command failed`)
      } else console.error(err)
      process.exit(1)
    }
  }
}

export function run(argv: string[] = process.argv) {
  const program = new commander.Command()
    .option("-f|--flat", "flat output without spinners")
    .option(
      "-s|--silent",
      "skip script output. ultra console logs will still be shown"
    )
    .option("--color", "colorize output", supportsColor.stdout.level > 0)
    .option("--no-color", "don't colorize output")
    .option("-d|--dry-run", "output what would be executed")
    .version(require("../package.json").version, "-v|--version")

  let offset = 2
  for (offset = 2; offset < argv.length; offset++) {
    if (!argv[offset].startsWith("-")) break
  }
  program.parse(argv.slice(0, offset))
  const packageFile = resolve(process.cwd(), "./package.json")
  const pkg = existsSync(packageFile)
    ? (require(packageFile) as PackageScripts)
    : { scripts: {} }
  const runner = new Runner(pkg, program.opts())
  const args = argv.slice(offset)
  if (args.length) runner.run(args.join(" "))
  else {
    program.outputHelp()
    console.log(
      chalk.underline("\nAvailable Scripts: ") +
        Object.keys(pkg.scripts).join(", ")
    )
    process.exit(1)
  }
}

if (module === require.main) {
  run()
}