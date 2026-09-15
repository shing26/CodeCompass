import { describe, expect, it } from 'vitest';
import {
  parseStackTrace,
  resolveFramesToSymbols,
  stackTraceSummary,
  type ParsedStackFrame
} from './repoqa-stacktrace';

describe('Issue 23 — parseStackTrace (Java)', () => {
  it('parses standard multi-frame Java traces with the crash site first', () => {
    const text = [
      'java.lang.NullPointerException: Cannot invoke order.id() because "order" is null',
      '\tat com.acme.shop.OrderService.cancel(OrderService.java:42)',
      '\tat com.acme.shop.OrderController.cancel(OrderController.java:18)',
      '\tat java.base/jdk.internal.reflect.NativeMethodAccessorImpl.invoke0(Native Method)',
      '\t... 3 common frames omitted'
    ].join('\n');
    const frames = parseStackTrace(text);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      className: 'OrderService',
      method: 'cancel',
      file: 'OrderService.java',
      line: 42
    });
    expect(frames[1]).toMatchObject({
      className: 'OrderController',
      method: 'cancel',
      file: 'OrderController.java',
      line: 18
    });
  });

  it('parses Caused by sections and keeps app frames in order', () => {
    const text = [
      'javax.persistence.PersistenceException: flush failed',
      '\tat org.hibernate.internal.SessionImpl.flush(SessionImpl.java:998)',
      'Caused by: java.sql.SQLIntegrityConstraintViolationException: duplicate key',
      '\tat com.mysql.cj.jdbc.exceptions.SQLError.createSQLException(SQLError.java:231)',
      '\tat com.acme.shop.OrderRepository.save(OrderRepository.java:77)',
      '\t... 11 more'
    ].join('\n');
    const frames = parseStackTrace(text);
    // hibernate/mysql infrastructure frames are app-agnostic but physical —
    // they parse; only reflection/jdk frames are noise-filtered.
    expect(frames.map((f) => f.method)).toEqual(['flush', 'createSQLException', 'save']);
    expect(frames[2]).toMatchObject({ className: 'OrderRepository', line: 77 });
  });

  it('keeps Native Method frames and frames without line numbers as physical frames', () => {
    const text = [
      '\tat com.acme.shop.LegacyRunner.run(LegacyRunner.java)',
      '\tat com.acme.shop.LegacyRunner.main(LegacyRunner.java:9)'
    ].join('\n');
    const frames = parseStackTrace(text);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ method: 'run', line: undefined });
    expect(frames[1]).toMatchObject({ method: 'main', line: 9 });
  });

  it('extracts app frames buried in log noise via the generic pattern', () => {
    const text =
      '2026-09-01 10:00:00 ERROR [http-nio-8080-exec-1] c.a.s.OrderService.cancel(OrderService.java:42) — request failed';
    const frames = parseStackTrace(text);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      className: 'OrderService',
      method: 'cancel',
      file: 'OrderService.java',
      line: 42
    });
  });

  it('filters reflection and JDK-internal frames entirely', () => {
    const text = [
      '\tat java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:103)',
      '\tat sun.reflect.GeneratedMethodAccessor123.invoke(Unknown Source)',
      '\tat java.lang.reflect.Method.invoke(Method.java:580)'
    ].join('\n');
    expect(parseStackTrace(text)).toHaveLength(0);
  });

  it('returns nothing for free text without physical frames', () => {
    expect(parseStackTrace('下单接口昨晚发版后开始 500，帮忙看看')).toHaveLength(0);
    expect(parseStackTrace('')).toHaveLength(0);
    expect(parseStackTrace('at (no content here)')).toHaveLength(0);
  });
});

describe('Issue 23 — parseStackTrace (TS/JS)', () => {
  it('parses V8 style frames with function and location', () => {
    const text = [
      'TypeError: Cannot read properties of undefined',
      '    at cancelOrder (src/services/orderService.ts:42:15)',
      '    at Object.handle (C:\\proj\\src\\routes\\orderRoutes.ts:18:9)'
    ].join('\n');
    const frames = parseStackTrace(text);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      className: '',
      method: 'cancelOrder',
      file: 'src/services/orderService.ts',
      line: 42
    });
    expect(frames[1]).toMatchObject({
      className: 'Object',
      method: 'handle',
      file: 'C:\\proj\\src\\routes\\orderRoutes.ts',
      line: 18
    });
  });

  it('parses bare location frames without a function name', () => {
    const frames = parseStackTrace('    at /app/dist/server.js:120:9');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ className: '', method: '', file: '/app/dist/server.js', line: 120 });
  });

  it('parses frames pasted without the leading "at"', () => {
    const frames = parseStackTrace('orderService.ts:42:15');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ method: '', file: 'orderService.ts', line: 42 });
  });
});

describe('Issue 23 — resolveFramesToSymbols', () => {
  interface Sym {
    name: string;
    parentType?: string;
    filePath: string;
  }
  const symbols: Sym[] = [
    { name: 'cancel', parentType: 'OrderService', filePath: 'src/OrderService.java' },
    { name: 'cancel', parentType: 'OrderService', filePath: 'test/OrderService.java' },
    { name: 'cancel', parentType: 'PaymentService', filePath: 'src/PaymentService.java' },
    { name: 'save', parentType: 'OrderRepository', filePath: 'src/OrderRepository.java' }
  ];
  const access = {
    name: (s: Sym) => s.name,
    parentType: (s: Sym) => s.parentType,
    filePath: (s: Sym) => s.filePath
  };

  const frame = (over: Partial<ParsedStackFrame>): ParsedStackFrame => ({
    className: 'OrderService',
    method: 'cancel',
    file: 'OrderService.java',
    line: 42,
    raw: 'at OrderService.cancel(OrderService.java:42)',
    ...over
  });

  it('prefers the same-file match and respects the class name guard', () => {
    const { matches, unmatched } = resolveFramesToSymbols(
      [frame({}), frame({ method: 'save', className: 'OrderRepository' })],
      symbols,
      access
    );
    expect(matches).toHaveLength(2);
    expect(matches[0].symbol.filePath).toBe('src/OrderService.java');
    expect(matches[1].symbol.parentType).toBe('OrderRepository');
    expect(unmatched).toHaveLength(0);
  });

  it('routes class-mismatched frames to unmatched instead of guessing', () => {
    const { matches, unmatched } = resolveFramesToSymbols(
      [frame({ className: 'RefundService' })],
      symbols,
      access
    );
    expect(matches).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
  });

  it('unmatched frames keep physical info for BREAK surfacing', () => {
    const { unmatched } = resolveFramesToSymbols(
      [frame({ method: 'ghostMethod', className: 'Ghost' })],
      symbols,
      access
    );
    expect(unmatched[0].method).toBe('ghostMethod');
    expect(unmatched[0].file).toBe('OrderService.java');
  });
});

describe('Issue 23 — stackTraceSummary', () => {
  it('describes crash frame and break count', () => {
    const resolution = resolveFramesToSymbols<ParsedStackFrame>(
      [
        { className: 'OrderService', method: 'cancel', file: 'OrderService.java', line: 42, raw: 'r1' },
        { className: 'Ghost', method: 'ghost', file: 'Ghost.java', line: 1, raw: 'r2' }
      ],
      [],
      { name: () => 'x', filePath: () => 'x.java' }
    );
    const summary = stackTraceSummary(resolution);
    expect(summary).toContain('2 frame(s) parsed, 0 resolved');
    expect(summary).toContain('Crash frame: OrderService.cancel (OrderService.java:42)');
    expect(summary).toContain('STATIC ANALYSIS BREAK');
  });
});
