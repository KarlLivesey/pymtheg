
import * as Parser from './parser'

/**
 * An abstract class which acts as the base for each command
 * in your project.
 */

export abstract class Command {

  protected async parse<F extends FlagOutput, B extends FlagOutput, A extends ArgOutput>(
    options?: Input<F, B, A>,
    argv = this.argv,
  ): Promise<ParserOutput<F, B, A>> {
    if (!options) options = this.ctor as Input<F, B, A>

    const opts = {
      context: this,
      ...options,
      flags: aggregateFlags<F, B>(options.flags, options.baseFlags, options.enableJsonFlag),
    }

    const hookResult = await this.config.runHook('preparse', {argv: [...argv], options: opts})

    // Since config.runHook will only run the hook for the root plugin, hookResult.successes will always have a length of 0 or 1
    // But to be extra safe, we find the result that matches the root plugin.
    const argvToParse = hookResult.successes?.length
      ? (hookResult.successes.find((s) => s.plugin.root === Cache.getInstance().get('rootPlugin')?.root)?.result ??
        argv)
      : argv
    this.argv = [...argvToParse]
    const results = await Parser.parse<F, B, A>(argvToParse, opts)
    this.warnIfFlagDeprecated(results.flags ?? {})
    this.parsed = true
    return results
  }
}
