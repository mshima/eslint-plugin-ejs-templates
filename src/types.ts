// Copyright 2024 The eslint-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

/**
 * EJS tag types used by the processor to classify each non-comment EJS tag.
 * Stored here as a shared reference for the processor and rules.
 */
export type EjsTagType = 'escaped-output' | 'raw-output' | 'slurp' | 'code' | 'code-slurpable';
