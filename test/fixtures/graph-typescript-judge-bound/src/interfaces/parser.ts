import {type Command} from '../command'

export type ArgParserContext = Command & {token: ArgToken}

export type ArgParser<T, P = CustomOptions> = (
  input: string,
  context: ArgParserContext,
  opts: P & Arg<T, P>,
) => Promise<T>

export type Arg<T, P = CustomOptions> = ArgProps & {
  options?: readonly T[]
  defaultHelp?: ArgDefaultHelp<T>
  input: string[]
  default?: ArgDefault<T | undefined>
  parse: ArgParser<T, P>
}
