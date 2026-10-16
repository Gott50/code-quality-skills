---
id: test-fixtures
title: Fixtures encapsulate setup, factories build data
when: { requires: [{ testFile: true }] }
source: research/testing.md
enforcedBy: []
---

Extract a fixture when setup and teardown belong together; use a factory when a test needs data.

A fixture establishes the environment for each test, giving it everything it needs and nothing else.
It is isolated between tests, encapsulates setup and teardown in one place, is reusable across files,
and is on-demand: only the fixtures a test asks for are built. That is what makes a test's
dependencies visible in its signature instead of hidden in a shared `beforeEach` that every test in
the file pays for.

A factory is a different tool. It builds the data the system under test consumes — an order, a user,
a request — with sensible defaults and per-test overrides, so a test states only the fields it cares
about. A double is a third thing: it replaces a collaborator, and the vocabulary is worth keeping
straight — a dummy is passed but never used, a stub answers with canned data, a spy records calls, a
mock is a stub with expectations.

Whether a fixture is worth extracting or a plain factory function will do is judgement. Extract a
fixture when the setup has a lifecycle — a server, a database, a temporary directory — and a factory
when it is only data.
