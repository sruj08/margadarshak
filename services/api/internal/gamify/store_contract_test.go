package gamify_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/sruj08/margadarshak/services/api/internal/gamify"
	"github.com/sruj08/margadarshak/services/api/internal/gamify/gamifytest"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
)

// The MemStore passes the same contract as internal/store.GamifyStore.
func TestMemStoreContract(t *testing.T) {
	gamifytest.RunStoreContract(t, gamifytest.MemFixture)
}

// A share card's badge_id must be one of B1..B9 whatever the kind (game.share_cards CHECK), and a
// declaration's case_id must be a wire cas_... id (records.declarations.case_id is a uuid).
func TestServiceValidatesWhatTheSchemaChecks(t *testing.T) {
	svc := &gamify.Service{Store: gamify.NewMemStore(), Clock: servertime.NewFixed(servertime.System{}.Now())}
	ctx := context.Background()
	me := gamify.Subject{Tenant: "JK", ApplicantID: uuid.New(), Account: true}
	var ve *gamify.ValidationError
	_, err := svc.CreateShareCard(ctx, me, gamify.ShareCardCreate{Kind: "rank", Display: "initials", DisplayText: "AK", BadgeID: "B10"})
	if !errors.As(err, &ve) || ve.Pointer != "/badge_id" {
		t.Fatalf("badge B10 on a rank card: %v", err)
	}
	_, err = svc.DeclareKhudLicence(ctx, me, gamify.KhudLicenceInput{CaseID: "case-1", DLIssuedOn: servertime.System{}.Now().AddDate(0, -1, 0), NoAgentUsed: true})
	if !errors.As(err, &ve) || ve.Pointer != "/case_id" {
		t.Fatalf("case_id case-1: %v", err)
	}
}
