package age_test

import (
	"testing"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/domain/age"
)

func d(s string) time.Time {
	t, err := time.Parse(time.DateOnly, s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestBands(t *testing.T) {
	asOf := d("2026-10-24")
	cases := []struct {
		dob  string
		p    age.Precision
		band age.Band
		min  bool
	}{
		{"2011-01-01", age.Day, age.Under16, true},
		{"2009-10-24", age.Day, age.B16to17, true}, // 17 today
		{"2008-10-25", age.Day, age.B16to17, true}, // turns 18 tomorrow
		{"2008-10-24", age.Day, age.B18to25, false},
		{"2000-10-24", age.Day, age.B26to40, false},
		{"1985-10-25", age.Day, age.B26to40, false}, // 40 years old; 41 tomorrow
		{"1974-06-01", age.Day, age.B41to60, false},
		{"1960-01-01", age.Day, age.Over60, false},
	}
	for _, c := range cases {
		a, err := age.Assess(d(c.dob), c.p, asOf)
		if err != nil {
			t.Fatal(err)
		}
		if a.Band != c.band || a.IsMinor != c.min || a.ParentalConsentRequired != c.min {
			t.Fatalf("%s: got %+v", c.dob, a)
		}
	}
}

// EC-01: year-only DOB is treated as 31 December (youngest possible), so a borderline
// learner is a minor until the year is over.
func TestEC01YearOnlyIsConservative(t *testing.T) {
	a, err := age.Assess(d("2008-01-01"), age.YearOnly, d("2026-10-24"))
	if err != nil {
		t.Fatal(err)
	}
	if a.Years != 17 || !a.IsMinor {
		t.Fatalf("year-only 2008 on 2026-10-24 must be 17: %+v", a)
	}
	a, _ = age.Assess(d("2008-01-01"), age.YearOnly, d("2026-12-31"))
	if a.Years != 18 || a.IsMinor {
		t.Fatalf("on 31 Dec the year-only learner turns 18: %+v", a)
	}
}

// EC-05: a 16-17 year old is a minor family member (parental consent), never blocked from AI.
func TestEC05SixteenSeventeenIsFamilyMember(t *testing.T) {
	a, _ := age.Assess(d("2009-03-14"), age.Day, d("2026-10-24"))
	if a.Band != age.B16to17 || a.UserBand != age.Minor || !a.ParentalConsentRequired {
		t.Fatalf("%+v", a)
	}
}

func TestFutureAndImplausible(t *testing.T) {
	if _, err := age.Assess(d("2030-01-01"), age.Day, d("2026-10-24")); err != age.ErrFutureDOB {
		t.Fatalf("future: %v", err)
	}
	if _, err := age.Assess(d("1890-01-01"), age.Day, d("2026-10-24")); err != age.ErrImplausibleDOB {
		t.Fatalf("implausible: %v", err)
	}
}
