// Package age computes age bands server-side from a date of birth and the IST server date
// (MD-049, EC-01, EC-05, EC-15). It is pure: no I/O, no clock reads.
//
// D-13 revised ("AI for everyone"): the band never switches a feature off. It decides only
// whether a family member is a minor, and so whether the adult account holder's recorded
// parental consent is needed before a case is opened for them.
package age

import (
	"errors"
	"time"
)

// Band is the canonical age band (api/openapi.yaml AgeBand).
type Band string

// Canonical bands. 41_60 covers ages 41 to 60 inclusive; 60_plus covers 61 and over.
const (
	Under16 Band = "under_16"
	B16to17 Band = "16_17"
	B18to25 Band = "18_25"
	B26to40 Band = "26_40"
	B41to60 Band = "41_60"
	Over60  Band = "60_plus"
)

// Precision is how much of the date of birth is known.
type Precision string

// Precisions. YearOnly is EC-01: the Aadhaar card shows only the year of birth.
const (
	Day      Precision = "day"
	YearOnly Precision = "year_only"
)

// UserBand is the coarse u18/adult split carried on sessions.
type UserBand string

// User bands.
const (
	Minor   UserBand = "u18"
	Adult   UserBand = "adult"
	Unknown UserBand = "unknown"
)

// ErrFutureDOB is returned when the date of birth is after the server date.
var ErrFutureDOB = errors.New("age: date of birth is in the future")

// ErrImplausibleDOB is returned for ages over 120.
var ErrImplausibleDOB = errors.New("age: date of birth is implausible")

// Years returns whole years of age on asOf (both IST calendar dates). With YearOnly precision
// the person is assumed born on 31 December of that year, the youngest possible age, so a
// borderline user is treated as younger (SECURITY_ARCHITECTURE §3.3).
func Years(dob time.Time, p Precision, asOf time.Time) (int, error) {
	y, m, d := dob.Date()
	if p == YearOnly {
		m, d = time.December, 31
	}
	ay, am, ad := asOf.Date()
	if ay < y || (ay == y && (am < m || (am == m && ad < d))) {
		return 0, ErrFutureDOB
	}
	years := ay - y
	if am < m || (am == m && ad < d) {
		years--
	}
	if years > 120 {
		return 0, ErrImplausibleDOB
	}
	return years, nil
}

// BandFor maps whole years to a band.
func BandFor(years int) Band {
	switch {
	case years < 16:
		return Under16
	case years < 18:
		return B16to17
	case years <= 25:
		return B18to25
	case years <= 40:
		return B26to40
	case years <= 60:
		return B41to60
	default:
		return Over60
	}
}

// Assessment is the server-side result of an age check.
type Assessment struct {
	Years    int
	Band     Band
	UserBand UserBand
	IsMinor  bool
	// ParentalConsentRequired is true for minors: a minor family member's case needs the adult
	// account holder's recorded consent (DPDP verifiable parental consent).
	ParentalConsentRequired bool
}

// Assess computes the band and minor status for a date of birth on asOf.
func Assess(dob time.Time, p Precision, asOf time.Time) (Assessment, error) {
	years, err := Years(dob, p, asOf)
	if err != nil {
		return Assessment{}, err
	}
	a := Assessment{Years: years, Band: BandFor(years), UserBand: Adult}
	if years < 18 {
		a.UserBand, a.IsMinor, a.ParentalConsentRequired = Minor, true, true
	}
	return a, nil
}
