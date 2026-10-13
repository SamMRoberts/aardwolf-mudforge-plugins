import luaparse from 'luaparse';

// Lua bindings become JavaScript bindings in MudForge. Property keys remain valid.
const reservedBindings = new Set([
  'arguments', 'eval', 'await', 'break', 'case', 'catch', 'class', 'const',
  'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export',
  'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import',
  'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private',
  'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw',
  'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
]);

export function parseMudForgeLua(source, label = 'Lua source') {
  const tree = luaparse.parse(source, {
    luaVersion: '5.1', encodingMode: 'x-user-defined', locations: true,
  });
  function check(identifier) {
    if (identifier?.type === 'Identifier' && reservedBindings.has(identifier.name)) {
      throw new Error(`${label}:${identifier.loc.start.line}: JavaScript reserved binding '${identifier.name}'; rename the Lua variable`);
    }
  }
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'LocalStatement') node.variables.forEach(check);
    if (node.type === 'FunctionDeclaration') {
      check(node.identifier);
      node.parameters.forEach(check);
    }
    if (node.type === 'ForGenericStatement') node.variables.forEach(check);
    if (node.type === 'ForNumericStatement') check(node.variable);
    if (node.type === 'AssignmentStatement') node.variables.forEach(check);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(tree);
  return tree;
}
