
import {type Arg, type ArgDefinition} from './interfaces/parser'

/**
 * Create an arg that infers the type from the provided options.
 *
 * The provided `options` must be a readonly array in order for type inference to work.
 *
 * @example
 * export default class MyCommand extends Command {
 *   static args = {
 *     stage: Args.option({
 *       options: ['production', 'staging', 'development'] as const,
 *     })(),
 *   }
 * }
 */
export function option<T extends readonly string[]>(
  defaults: Omit<Partial<Arg<ReadonlyElementOf<T>>>, 'default' | 'multiple' | 'required'> & {options: T},
): ArgDefinition<(typeof defaults.options)[number]> {
  return (options: any = {}) => ({
    parse: async (i: string, _context: Command, _opts: Record<string, unknown>) => i,
    ...defaults,
    ...options,
    input: [] as string[],
    type: 'option',
  })
}
