// Package telemetry sets up OpenTelemetry tracing (MD-051). The default exporter is "none":
// spans are created (so trace IDs flow into logs and problem+json trace_id) but not exported.
// OTEL_TRACES_EXPORTER=stdout prints spans for local debugging; an OTLP exporter to the
// India-hosted collector is the production path (not wired in the hackathon build).
package telemetry

import (
	"context"
	"fmt"
	"os"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// Setup installs the global tracer provider and W3C trace-context propagator. The returned
// function flushes and shuts the provider down.
func Setup(ctx context.Context, service, version, exporter string) (func(context.Context) error, error) {
	res := resource.NewSchemaless(
		attribute.String("service.name", service),
		attribute.String("service.version", version),
	)
	opts := []sdktrace.TracerProviderOption{sdktrace.WithResource(res)}
	switch exporter {
	case "", "none":
		// No span processor: spans are recorded for context propagation only.
	case "stdout":
		exp, err := stdouttrace.New(stdouttrace.WithWriter(os.Stderr))
		if err != nil {
			return nil, fmt.Errorf("telemetry: %w", err)
		}
		opts = append(opts, sdktrace.WithBatcher(exp))
	default:
		return nil, fmt.Errorf("telemetry: unsupported OTEL_TRACES_EXPORTER %q (none|stdout)", exporter)
	}
	tp := sdktrace.NewTracerProvider(opts...)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	return tp.Shutdown, nil
}
