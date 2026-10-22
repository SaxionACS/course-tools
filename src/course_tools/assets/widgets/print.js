// The build-time side of the widgets: widgets.py runs this with `quarto run print.js IN OUT`
// (Quarto's Deno). It loads widgets.js, the script the browser runs, and checks every widget
// and draws its form for the PDF with the same code.
//   IN:  [{id, config}]        the widgets, configurations as JSON
//   OUT: {id: result}          see Widget.print in widgets.js
const here = new URL('.', import.meta.url);
(0, eval)(await Deno.readTextFile(new URL('widgets.js', here)));

const [input, output] = Deno.args;
const items = JSON.parse(await Deno.readTextFile(input));
const results = {};
for (const {id, config} of items) results[id] = globalThis.CourseWidgets.print(config);
await Deno.writeTextFile(output, JSON.stringify(results));
