// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Package logger provides a context-scoped slog.Logger.
package logger

import (
	"context"
	"log/slog"
	"os"

	"github.com/firebase/genkit/go/internal/base"
)

func init() {
	// TODO: Remove this. The main program should be responsible for configuring logging.
	// This is just a convenience during development.
	baseHandler := slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{})
	debugHandler := &DebugOnlyHandler{
		h: baseHandler,
	}
	slog.SetDefault(slog.New(debugHandler))
}

var loggerKey = base.NewContextKey[*slog.Logger]()

// FromContext returns the Logger in ctx, or the default Logger
// if there is none.
func FromContext(ctx context.Context) *slog.Logger {
	if l := loggerKey.FromContext(ctx); l != nil {
		return l
	}
	return slog.Default()
}

// DebugOnlyHandler is a custom handler that only logs DEBUG messages.
type DebugOnlyHandler struct {
	h slog.Handler
}

func (dDebugOnlyHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return level == slog.LevelDebug
}

func (d DebugOnlyHandler) Handle(ctx context.Context, r slog.Record) error {
	return d.h.Handle(ctx, r)
}

func (dDebugOnlyHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &DebugOnlyHandler{h: d.h.WithAttrs(attrs)}
}

func (d *DebugOnlyHandler) WithGroup(name string) slog.Handler {
	return &DebugOnlyHandler{h: d.h.WithGroup(name)}
}
