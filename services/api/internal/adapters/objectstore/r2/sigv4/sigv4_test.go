package sigv4

import (
	"bytes"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

// The AWS documentation's example credentials and instant (S3 SigV4 examples).
var (
	awsExample = Signer{
		AccessKeyID:     "AKIAIOSFODNN7EXAMPLE",
		SecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
		Region:          "us-east-1",
		Service:         "s3",
	}
	awsTime = time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC)
)

// Known answer: "Example: A presigned URL for GET object" (AWS S3 docs, "Authenticating Requests:
// Using Query Parameters (AWS Signature Version 4)").
func TestKnownAnswerPresignedGET(t *testing.T) {
	u, _ := url.Parse("https://examplebucket.s3.amazonaws.com/test.txt")
	got, err := awsExample.Presign(http.MethodGet, u, nil, awsTime, 86400*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	const wantSig = "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"
	if s := got.Query().Get("X-Amz-Signature"); s != wantSig {
		t.Fatalf("signature %s, want %s", s, wantSig)
	}
	const wantQuery = "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
		"&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=" + wantSig
	if got.RawQuery != wantQuery {
		t.Fatalf("query\n got %s\nwant %s", got.RawQuery, wantQuery)
	}
	// The verifier accepts it inside the window and rejects it after.
	r, _ := http.NewRequest(http.MethodGet, got.String(), nil)
	if err := awsExample.Verify(r, nil, awsTime.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := awsExample.Verify(r, nil, awsTime.Add(86401*time.Second)); err != ErrExpired {
		t.Fatalf("after expiry: %v", err)
	}
}

// Known answer: "Example: GET Object" (Authorization header, with a Range header).
func TestKnownAnswerHeaderGET(t *testing.T) {
	r, _ := http.NewRequest(http.MethodGet, "https://examplebucket.s3.amazonaws.com/test.txt", nil)
	r.Header.Set("Range", "bytes=0-9")
	awsExample.SignRequest(r, EmptySHA256, awsTime)
	const want = "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
		"SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
		"Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
	if got := r.Header.Get("Authorization"); got != want {
		t.Fatalf("authorization\n got %s\nwant %s", got, want)
	}
	if err := awsExample.Verify(r, nil, awsTime); err != nil {
		t.Fatal(err)
	}
}

// Known answer: "Example: PUT Object" (path with '$', Date and storage-class headers, signed payload).
func TestKnownAnswerHeaderPUT(t *testing.T) {
	body := []byte("Welcome to Amazon S3.")
	r, _ := http.NewRequest(http.MethodPut, "https://examplebucket.s3.amazonaws.com/test$file.text", bytes.NewReader(body))
	r.Header.Set("Date", "Fri, 24 May 2013 00:00:00 GMT")
	r.Header.Set("X-Amz-Storage-Class", "REDUCED_REDUNDANCY")
	awsExample.SignRequest(r, PayloadHash(body), awsTime)
	const wantSig = "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd"
	if got := r.Header.Get("Authorization"); !strings.HasSuffix(got, "Signature="+wantSig) ||
		!strings.Contains(got, "SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class,") {
		t.Fatalf("authorization %s", got)
	}
	if r.URL.EscapedPath() != "/test%24file.text" {
		t.Fatalf("wire path %s", r.URL.EscapedPath())
	}
	if err := awsExample.Verify(r, body, awsTime); err != nil {
		t.Fatal(err)
	}
	if err := awsExample.Verify(r, []byte("tampered"), awsTime); err != ErrPayload {
		t.Fatalf("tampered body: %v", err)
	}
}

func TestVerifyRejects(t *testing.T) {
	u, _ := url.Parse("https://examplebucket.s3.amazonaws.com/test.txt")
	signed, _ := awsExample.Presign(http.MethodGet, u, nil, awsTime, time.Hour)
	for name, mutate := range map[string]func(*url.URL) (string, Signer){
		"other method": func(u *url.URL) (string, Signer) { return http.MethodPut, awsExample },
		"other key": func(u *url.URL) (string, Signer) {
			u.Path = "/other.txt"
			return http.MethodGet, awsExample
		},
		"wrong secret": func(u *url.URL) (string, Signer) {
			s := awsExample
			s.SecretAccessKey = "nope"
			return http.MethodGet, s
		},
		"extra query": func(u *url.URL) (string, Signer) {
			u.RawQuery += "&x=1"
			return http.MethodGet, awsExample
		},
	} {
		t.Run(name, func(t *testing.T) {
			v := *signed
			method, s := mutate(&v)
			v.RawPath = ""
			r, _ := http.NewRequest(method, v.String(), nil)
			if err := s.Verify(r, nil, awsTime); err == nil {
				t.Fatal("accepted")
			}
		})
	}
	r, _ := http.NewRequest(http.MethodGet, "https://examplebucket.s3.amazonaws.com/test.txt", nil)
	if err := awsExample.Verify(r, nil, awsTime); err != ErrNoAuth {
		t.Fatalf("unsigned: %v", err)
	}
	if _, err := awsExample.Presign(http.MethodGet, u, nil, awsTime, 8*24*time.Hour); err == nil {
		t.Fatal("accepted an 8-day presign")
	}
}

func TestEncode(t *testing.T) {
	for in, want := range map[string]string{
		"clips/JMU-0012/v3/360p.mp4": "clips/JMU-0012/v3/360p.mp4",
		"a b+c@d~e":                  "a%20b%2Bc%40d~e",
		"/test$file.text":            "/test%24file.text",
	} {
		if got := Encode(in, false); got != want {
			t.Errorf("Encode(%q) = %q, want %q", in, got, want)
		}
	}
	if got := Encode("a/b", true); got != "a%2Fb" {
		t.Errorf("query slash: %q", got)
	}
}
