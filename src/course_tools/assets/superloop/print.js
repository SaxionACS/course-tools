// The build-time side of the superloop blocks: superloop.py runs this with
// `quarto run print.js IN OUT` (Quarto's Deno). It loads superloop.js, the
// script the browser runs, and checks every block and draws its form for the
// PDF with the same code (the program runs with the block's script, in the
// script's own sandboxed interpreter).
//   IN:  [{id, config}]        the blocks, configurations as JSON
//   OUT: {id: result}          see print in superloop.js
const here = new URL('.', import.meta.url);
(0, eval)(await Deno.readTextFile(new URL('superloop.js', here)));

const [input, output] = Deno.args;
const items = JSON.parse(await Deno.readTextFile(input));
const results = {};
for (const {id, config} of items) results[id] = globalThis.CourseSuperloop.print(config);
await Deno.writeTextFile(output, JSON.stringify(results));
