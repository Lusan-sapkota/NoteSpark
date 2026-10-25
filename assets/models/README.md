# Search model

Used on the device for search by meaning (`src/storage/semanticSearch.ts`). Nothing is downloaded at run time.

- `all-MiniLM-L6-v2-int8.onnx`: `onnx/model_quantized.onnx` from [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2), an ONNX int8 export of [sentence-transformers/all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2).
- `all-MiniLM-L6-v2-vocab.txt`: `vocab.txt` from the same repository.

Both are licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
