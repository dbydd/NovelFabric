#!/usr/bin/env node

import { Command } from "commander";

export function buildProgram(): Command {
  const program = new Command();
  program.name("novelfabric").description("NovelFabric V4 workspace CLI").version("0.1.0");

  return program;
}

const program = buildProgram();
await program.parseAsync(process.argv);
