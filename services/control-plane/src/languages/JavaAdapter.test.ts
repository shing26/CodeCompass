import { describe, expect, it } from 'vitest';
import { JavaAdapter } from './JavaAdapter';

/**
 * v1.4.2 — Spring mapping annotations with no explicit path.
 *
 * `@PostMapping` (bare) and `@RequestMapping(method = GET)` are real HTTP
 * entries: Spring dispatches them to the class-level prefix (or `/`). The old
 * path collector only matched annotations followed by `(`, so the bare form
 * produced no `displayPath`, and the handler was counted as an orphan even
 * though the framework owns the call.
 */

const CONTROLLER = `package com.demo;

@RestController
@RequestMapping("/api")
public class OwnerController {
    @PostMapping
    public String create() { return "ok"; }

    @PostMapping("/edit")
    public String edit() { return "ok"; }

    @GetMapping
    public String list() { return "ok"; }

    @RequestMapping(method = RequestMethod.GET)
    public String probe() { return "ok"; }

    public String helper() { return "plain"; }
}
`;

const ROOT_CONTROLLER = `package com.demo;

@RestController
public class RootController {
    @GetMapping
    public String root() { return "ok"; }
}
`;

const PLAIN_CLASS = `package com.demo;

public class NotAController {
    @PostMapping
    public String notAnEntry() { return "x"; }
}
`;

function symbolsOf(source: string) {
  return JavaAdapter.parseSource(source, 'src/main/java/com/demo/Demo.java', 'r');
}

function byName(source: string, name: string) {
  return symbolsOf(source).find((symbol) => symbol.name === name)!;
}

describe('JavaAdapter bare mapping annotations (v1.4.2)', () => {
  it('gives a bare @PostMapping the class-level prefix', () => {
    expect(byName(CONTROLLER, 'create').displayPath).toBe('/api');
  });

  it('treats a mapping annotation without a path argument the same way', () => {
    expect(byName(CONTROLLER, 'probe').displayPath).toBe('/api');
  });

  it('keeps explicit method paths unchanged', () => {
    expect(byName(CONTROLLER, 'edit').displayPath).toBe('/api/edit');
  });

  it('uses the root path when the controller has no class-level prefix', () => {
    expect(byName(ROOT_CONTROLLER, 'root').displayPath).toBe('/');
  });

  it('leaves unmapped methods and non-controller classes alone', () => {
    expect(byName(CONTROLLER, 'helper').displayPath).toBeUndefined();
    expect(byName(PLAIN_CLASS, 'notAnEntry').displayPath).toBeUndefined();
  });

  it('still records the controller class as a route symbol', () => {
    const symbols = symbolsOf(CONTROLLER);
    const controller = symbols.filter((symbol) => symbol.kind === 'route');
    expect(controller.map((symbol) => symbol.name)).toContain('OwnerController');
    expect(controller[0]?.displayPath).toBe('/api');
  });
});
