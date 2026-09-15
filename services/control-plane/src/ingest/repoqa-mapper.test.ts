import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractMapperSymbols, parseMapperXml } from './repoqa-mapper';

describe('MyBatis mapper XML parser', () => {
  it('extracts namespace, statement ids, line numbers and SQL summaries', () => {
    const source = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">',
      '<mapper namespace="com.demo.OrderMapper">',
      '  <select id="findAll" resultType="com.demo.Order">',
      '    SELECT id, amount FROM orders',
      '  </select>',
      '  <insert id="insertOrder">',
      '    INSERT INTO orders (id, amount) VALUES (#{id}, #{amount})',
      '  </insert>',
      '</mapper>'
    ].join('\n');

    const mapper = parseMapperXml(
      source,
      'src/main/resources/mapper/OrderMapper.xml'
    );

    expect(mapper).toMatchObject({
      filePath: 'src/main/resources/mapper/OrderMapper.xml',
      namespace: 'com.demo.OrderMapper',
      lineStart: 3,
      lineEnd: 10
    });
    expect(mapper?.statements).toHaveLength(2);
    expect(mapper?.statements[0]).toMatchObject({
      id: 'findAll',
      kind: 'select',
      lineStart: 4,
      lineEnd: 6,
      sqlSummary: 'SELECT id, amount FROM orders'
    });
    expect(mapper?.statements[1]).toMatchObject({
      id: 'insertOrder',
      kind: 'insert',
      lineStart: 7,
      lineEnd: 9,
      sqlSummary: 'INSERT INTO orders (id, amount) VALUES (#{id}, #{amount})'
    });
  });

  it('normalizes CDATA and dynamic XML fragments into a SQL summary', () => {
    const source = [
      '<mapper namespace="com.demo.OrderMapper">',
      '  <select id="findActive">',
      '    <![CDATA[',
      '      SELECT * FROM orders',
      '      WHERE status = #{status}',
      '    ]]>',
      '  </select>',
      '</mapper>'
    ].join('\n');

    const mapper = parseMapperXml(source);
    expect(mapper?.statements[0]?.sqlSummary).toBe(
      'SELECT * FROM orders WHERE status = #{status}'
    );
    expect(mapper?.statements[0]?.lineStart).toBe(2);
    expect(mapper?.statements[0]?.lineEnd).toBe(7);
  });

  it('returns null for XML without a mapper namespace or statements', () => {
    expect(parseMapperXml('<project><artifactId>demo</artifactId></project>')).toBeNull();
    expect(
      parseMapperXml('<mapper namespace="com.demo.EmptyMapper"></mapper>')
    ).toBeNull();
  });
});

describe('MyBatis mapper symbol extraction', () => {
  it('indexes mapper files as mapper + sql symbols with XML anchors', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-mapper-symbols-'));
    try {
      const mapperPath = path.join(
        root,
        'src',
        'main',
        'resources',
        'mapper',
        'OrderMapper.xml'
      );
      await fs.mkdir(path.dirname(mapperPath), { recursive: true });
      await fs.writeFile(
        mapperPath,
        [
          '<mapper namespace="com.demo.OrderMapper">',
          '  <select id="findAll" resultType="com.demo.Order">',
          '    SELECT id FROM orders',
          '  </select>',
          '</mapper>'
        ].join('\n')
      );
      const pomPath = path.join(root, 'pom.xml');
      await fs.writeFile(pomPath, '<project></project>');

      const symbols = await extractMapperSymbols('repo-1', root, [
        mapperPath,
        pomPath
      ]);

      expect(symbols).toHaveLength(2);
      expect(symbols[0]).toMatchObject({
        kind: 'mapper',
        name: 'OrderMapper',
        filePath: 'src/main/resources/mapper/OrderMapper.xml',
        displayPath: 'com.demo.OrderMapper',
        lineStart: 1,
        lineEnd: 5
      });
      expect(symbols[1]).toMatchObject({
        kind: 'sql',
        name: 'findAll',
        parentType: 'OrderMapper',
        filePath: 'src/main/resources/mapper/OrderMapper.xml',
        displayPath: 'com.demo.OrderMapper#findAll',
        lineStart: 2,
        lineEnd: 4
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});


describe('v0.7 — dynamic SQL shape in summaries', () => {
  it('censuses dynamic tags and keeps them visible in the summary', () => {
    const source = [
      '<mapper namespace="com.demo.UserMapper">',
      '  <select id="findUsers" resultType="User">',
      '    SELECT * FROM users',
      '    <where>',
      '      <if test="name != null">AND name = #{name}</if>',
      '      <choose>',
      '        <when test="age != null">AND age = #{age}</when>',
      '        <otherwise>AND age &gt;= 18</otherwise>',
      '      </choose>',
      '    </where>',
      '    <foreach collection="ids" item="id" open="(" close=")" separator=",">#{id}</foreach>',
      '  </select>',
      '</mapper>'
    ].join('\n');
    const file = parseMapperXml(source);
    const summary = file?.statements[0].sqlSummary ?? '';
    expect(summary).toContain('[dynamic: choose×1, when×1, otherwise×1, foreach×1, if×1, where×1]');
  });

  it('omits the marker for static SQL', () => {
    const source = [
      '<mapper namespace="com.demo.ItemMapper">',
      '  <select id="allItems">SELECT * FROM items</select>',
      '</mapper>'
    ].join('\n');
    const file = parseMapperXml(source);
    expect(file?.statements[0].sqlSummary ?? '').not.toContain('[dynamic:');
  });
});
