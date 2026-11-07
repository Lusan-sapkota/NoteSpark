# sqlite-vec, 16 KB aligned

`<abi>/vec.so` are sqlite-vec v0.1.7-alpha.2 (MIT/Apache-2.0, https://github.com/asg017/sqlite-vec) rebuilt from the
release's `sqlite-vec-0.1.7-alpha.2-amalgamation.tar.gz` because expo-sqlite's prebuilt copies are 4 KB aligned.
`plugins/withVec16kb.js` adds this folder to the app's jniLibs.

Rebuild (NDK 27.1.12297006, API 24; `hdr/` holds only `sqlite3.h` and `sqlite3ext.h`):

    clang --target=<triple>24 -O3 -fPIC -shared -I. -Ihdr [-DSQLITE_VEC_ENABLE_NEON on arm64] sqlite-vec.c \
      -o <abi>/vec.so -Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384 -Wl,--build-id=none -s

Triples: aarch64-linux-android (arm64-v8a), armv7a-linux-androideabi (armeabi-v7a), i686-linux-android (x86),
x86_64-linux-android (x86_64). Check with `readelf -lW vec.so | rg LOAD` (Align `0x4000`).
