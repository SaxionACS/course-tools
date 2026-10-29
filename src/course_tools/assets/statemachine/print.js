// The build-time side of the state machines: statemachine.py runs this with
// `quarto run print.js IN OUT` (Quarto's Deno). It loads dagre and
// statemachine.js, the scripts the browser runs, and checks every machine and
// draws its form for the PDF with the same code.
//   IN:  [{id, config}]        the machines, configurations as JSON
//   OUT: {id: result}          see print in statemachine.js
const here = new URL('.', import.meta.url);
// dagre.min.js is strict code, so its `var dagre` stays inside eval: make it global.
(0, eval)(await Deno.readTextFile(new URL('dagre.min.js', here)) + '\nglobalThis.dagre = dagre;');
(0, eval)(await Deno.readTextFile(new URL('statemachine.js', here)));

const [input, output] = Deno.args;
const items = JSON.parse(await Deno.readTextFile(input));
const results = {};
for (const {id, config} of items) results[id] = globalThis.CourseStatemachines.print(config);
await Deno.writeTextFile(output, JSON.stringify(results));
